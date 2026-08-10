import { Router, Request, Response } from 'express';
import { getAiProfileWithKeys } from '../models/ai-profiles.ts';
import { getProvider } from '../models/providers.ts';
import { createLlmClientForProvider } from '../integrations/client-factory.ts';
import { buildProviderChatOptions } from '../services/ai-profile-runtime-options.ts';
import type { ExpectedSchemaInput } from '../services/expected-schema-to-json-schema.ts';
import { applyFormattingRules } from '../services/formatting-rules.ts';
import { getSetting } from '../models/app-settings.ts';
import { resolveAttachmentsAsText } from '../services/attachment-resolver.ts';
import { DiagnosticSession } from '../services/ai-diagnostics.ts';
import { getAuthContext } from '../db/tenant.ts';
import { errorMessage } from '../lib/error-message.ts';
import { validateBody } from '../middleware/validate.ts';
import { runSlotSchema } from '../schemas/ai-matcher.ts';
import type { FormattingRule, FormattingStep } from '../types.ts';

const router = Router();

const DEFAULT_TIMEOUT_MS = 300_000;

interface SlotConfig {
  type: string;
  profileId?: string;
  providerId?: string;
  externalAiId?: string;
  runtimeOptions?: Record<string, unknown>;
  /**
   * The job's expectedSchema, so a comparison can exercise NATIVE structured output.
   *
   * Without it the matcher only ever measured prompt-following: a model-vs-model run looked
   * conclusive while the strict json_schema that production actually sends was absent, so a model
   * could emit a field the schema forbids and still appear to pass. Comparing models for a
   * schema-bound job is exactly what this tool is for, and it could not do it.
   */
  expectedSchema?: ExpectedSchemaInput | null;
}

interface ResolvedSlot {
  client: ReturnType<typeof createLlmClientForProvider>;
  model: string;
  chatOptions: Record<string, unknown>;
  providerName: string;
  providerType: string;
  profileName: string | null;
  timeoutMs: number;
}

async function getDefaultTimeout(): Promise<number> {
  const setting = await getSetting('default_llm_timeout_ms');
  return Number((setting?.value as Record<string, unknown>)?.value) || DEFAULT_TIMEOUT_MS;
}

/**
 * Resolve a single AI slot into { client, model, chatOptions, providerName }.
 * Supports two slot types:
 *   - "profile" — loads an existing AI profile + provider from the database
 *   - "adhoc"   — loads just the provider and uses caller-supplied config
 */
async function resolveSlot(slot: SlotConfig): Promise<ResolvedSlot> {
  if (slot.type === 'profile') {
    if (!slot.profileId) throw new Error('profileId is required for profile slots');
    const profile = await getAiProfileWithKeys(slot.profileId);
    if (!profile) throw new Error(`AI profile "${slot.profileId}" not found`);
    const provider = profile.provider;
    if (!provider) throw new Error(`Provider not found for profile "${profile.name}"`);
    const client = createLlmClientForProvider(provider);
    const model = String(profile.external_ai_id || '').trim();
    const chatOptions = buildProviderChatOptions(provider.type, profile.runtime_options ?? undefined, {
      expectedSchema: slot.expectedSchema ?? null,
    });
    const timeoutMs = Number(provider.request_timeout_ms) || (await getDefaultTimeout());
    return {
      client,
      model,
      chatOptions,
      providerName: provider.name,
      providerType: provider.type,
      profileName: profile.name,
      timeoutMs,
    };
  }

  if (slot.type === 'adhoc') {
    if (!slot.providerId) throw new Error('providerId is required for adhoc slots');
    const provider = await getProvider(slot.providerId);
    if (!provider) throw new Error(`Provider "${slot.providerId}" not found`);
    const client = createLlmClientForProvider(provider);
    const model = String(slot.externalAiId || '').trim();
    const chatOptions = buildProviderChatOptions(provider.type, slot.runtimeOptions || {}, {
      expectedSchema: slot.expectedSchema ?? null,
    });
    const timeoutMs = Number(provider.request_timeout_ms) || (await getDefaultTimeout());
    return {
      client,
      model,
      chatOptions,
      providerName: provider.name,
      providerType: provider.type,
      profileName: null,
      timeoutMs,
    };
  }

  throw new Error(`Unknown slot type "${slot.type}"`);
}

/**
 * Execute a single prompt against one resolved slot.
 * Returns a result object with timing, raw content, usage, etc.
 */
async function executeSlot(resolved: ResolvedSlot, prompt: string, formattingRules: FormattingRule[]) {
  const t0 = Date.now();
  const messages = [{ role: 'user' as const, content: prompt }];

  const resp = await resolved.client.chatCompletion(resolved.model, messages, {
    ...resolved.chatOptions,
    timeoutMs: resolved.timeoutMs,
  });

  const rawContent = resp.choices?.[0]?.message?.content || '';
  const usage = resp.usage || null;
  const finishReason = resp.choices?.[0]?.finish_reason || null;
  const durationMs = Date.now() - t0;

  let formatted: string | null = null;
  let formattingSteps: FormattingStep[] | null = null;
  if (formattingRules && formattingRules.length > 0) {
    const fmtResult = applyFormattingRules(rawContent, formattingRules);
    formatted = fmtResult.formatted;
    formattingSteps = fmtResult.steps;
  }

  return {
    status: 'success',
    /**
     * Whether a NATIVE json_schema actually went out with this request. Reported because its
     * absence is invisible from the outside: a comparison run without it looks conclusive while
     * measuring only prompt-following, and a model can emit a field the schema forbids and appear
     * to pass. Derived from the built options rather than the input, so it answers "did we send
     * one", not "was one asked for".
     */
    nativeSchema: Boolean((resolved.chatOptions as Record<string, unknown>).text),
    raw: rawContent,
    formatted,
    formattingSteps,
    durationMs,
    model: resp.model || resolved.model,
    provider: resolved.providerName,
    profileName: resolved.profileName,
    usage,
    finishReason,
    error: null,
  };
}

/* ================================================================
   POST /api/ai-matcher/run-slot
   Execute a single AI slot. The frontend fires one request per slot
   in parallel so results stream back independently as each finishes.
   ================================================================ */
router.post('/run-slot', validateBody(runSlotSchema), async (req: Request, res: Response) => {
  const ctx = getAuthContext();
  const diag = new DiagnosticSession('', req.body?.callingApplication || 'ai-matcher', true, ctx?.workspaceId ?? null);

  try {
    const { prompt, slot, formattingRules = [], slotIndex = 0, attachments } = req.body;

    let effectivePrompt = prompt;
    if (Array.isArray(attachments) && attachments.length > 0) {
      const textFiles = await resolveAttachmentsAsText(attachments);
      if (textFiles.length > 0) {
        const fileBlock = textFiles
          .map((f: { fileName: string; content: string }) => `--- ${f.fileName} ---\n${f.content}`)
          .join('\n\n');
        effectivePrompt = `${fileBlock}\n\n---\n\n${prompt}`;
      }
    }

    const resolved = await resolveSlot(slot);
    const result = await executeSlot(resolved, effectivePrompt, formattingRules);

    diag.complete('success').catch(() => {});
    return res.json({ slotIndex, ...result });
  } catch (err) {
    console.error('[POST /ai-matcher/run-slot]', err);
    diag.complete('error', errorMessage(err)).catch(() => {});
    return res.json({
      slotIndex: req.body?.slotIndex ?? 0,
      status: 'error',
      raw: null,
      formatted: null,
      formattingSteps: null,
      durationMs: null,
      model: req.body?.slot?.externalAiId || req.body?.slot?.profileId || 'unknown',
      provider: null,
      profileName: null,
      usage: null,
      finishReason: null,
      error: 'Slot execution failed',
    });
  }
});

export default router;
