/**
 * Routes – AI Profiles
 * ---------------------
 * CRUD for AI Profiles — each profile maps to a specific AI
 * within an LLM provider (e.g. a Devs.ai AI UUID) or directly
 * to a raw LLM model ID for pure model chat.
 *
 * profile_type: 'agent' (Devs.ai agent) | 'model' (raw LLM model ID)
 */

import { Router, Request, Response } from 'express';
import {
  createAiProfile,
  updateAiProfile,
  listAiProfiles,
  getAiProfile,
  getAiProfileWithKeys,
  deleteAiProfile,
  setDefaultAiProfile,
  clearDefaultAiProfile,
  getDefaultAiProfile,
} from '../models/ai-profiles.ts';
import { getProvider } from '../models/providers.ts';
import { createLlmClientForProvider, createDevsAiClientForUser } from '../integrations/client-factory.ts';
import { normaliseAiProfileRuntimeOptions, buildProviderChatOptions } from '../services/ai-profile-runtime-options.ts';
import { getSetting } from '../models/app-settings.ts';
import { getAuthContext, effectiveUserId } from '../db/tenant.ts';
import { stripSecrets } from '../lib/sanitize.ts';
import { errorMessage } from '../lib/error-message.ts';
import { safeClientError, safeStatusError } from '../lib/safe-error.ts';
import type { ChatMessage } from '../types.ts';
import { validateBody } from '../middleware/validate.ts';
import { requireRole } from '../middleware/require-role.ts';
import { createAiProfileSchema, updateAiProfileSchema } from '../schemas/ai-profiles.ts';
import { parsePagination, buildPaginatedResponse } from '../lib/pagination.ts';
import { z } from 'zod';
import type { ProviderRow, ProcessingJobRow, ChatCompletionResponse, AiProfileRow } from '../types.ts';

const testChatSchema = z.object({
  message: z.string().min(1).max(50_000),
  systemPrompt: z.string().max(50_000).optional(),
});

const DEFAULT_TIMEOUT_MS = 300_000;

async function resolveTestChatTimeout(provider: ProviderRow): Promise<number> {
  const providerTimeout = Number(provider?.request_timeout_ms) || 0;
  if (providerTimeout > 0) return providerTimeout;
  try {
    const setting = await getSetting('default_llm_timeout_ms');
    const systemTimeout = Number((setting?.value as Record<string, unknown>)?.value) || 0;
    if (systemTimeout > 0) return systemTimeout;
  } catch (_err) {
    /* fall through */
  }
  return DEFAULT_TIMEOUT_MS;
}

const router = Router();

/**
 * Validate failover fields: both must be set together, or both null.
 * Returns { failover_provider_id, failover_external_ai_id } ready for DB.
 */
function normaliseFailoverFields(
  providerId: unknown,
  externalAiId: unknown,
): { failover_provider_id: string | null; failover_external_ai_id: string | null } {
  const pId = String(providerId || '').trim() || null;
  const aiId = String(externalAiId || '').trim() || null;
  if ((pId && !aiId) || (!pId && aiId)) {
    throw new Error('failover_provider_id and failover_external_ai_id must both be set or both be empty');
  }
  return { failover_provider_id: pId, failover_external_ai_id: aiId };
}

/* ================================================================
   GET /api/ai-profiles
   ================================================================ */

router.get('/', async (req: Request, res: Response) => {
  try {
    const { provider_id } = req.query as { provider_id?: string };
    const params = parsePagination(req);
    const rows = await listAiProfiles(provider_id ?? undefined, {
      cursor: params.cursor ?? undefined,
      limit: params.limit,
    });
    return res.json(buildPaginatedResponse(rows, params));
  } catch (err) {
    console.error('[GET /ai-profiles]', err);
    return res.status(500).json({ error: 'Failed to list AI profiles' });
  }
});

/* ================================================================
   POST /api/ai-profiles
   ================================================================ */

router.post(
  '/',
  requireRole('owner', 'admin'),
  validateBody(createAiProfileSchema),
  async (req: Request, res: Response) => {
    try {
      const {
        provider_id,
        external_ai_id,
        failover_provider_id,
        failover_external_ai_id,
        failover_runtime_options,
        name,
        description,
        is_active,
        profile_type,
        mode,
        runtime_options,
        config,
      } = req.body;

      const provider = await getProvider(provider_id);

      let resolvedType = profile_type || 'agent';
      if (provider?.type === 'google-gemini') {
        resolvedType = 'model';
      }

      const failover = normaliseFailoverFields(failover_provider_id, failover_external_ai_id);

      if (failover.failover_provider_id) {
        const fp = await getProvider(failover.failover_provider_id);
        if (!fp) return res.status(400).json({ error: `Failover provider ${failover.failover_provider_id} not found` });
      }

      const resolvedMode = mode || 'completion';

      const row = await createAiProfile({
        provider_id,
        external_ai_id,
        ...failover,
        ...(failover_runtime_options !== undefined && { failover_runtime_options }),
        name,
        description: description || null,
        is_active: is_active !== false,
        profile_type: resolvedType,
        mode: resolvedMode,
        runtime_options: normaliseAiProfileRuntimeOptions(provider?.type, runtime_options) as unknown as Record<
          string,
          unknown
        >,
        ...(config !== undefined && { config }),
      });

      return res.status(201).json(row);
    } catch (err) {
      if (errorMessage(err).includes('failover_provider_id') || errorMessage(err).includes('failover_external_ai_id')) {
        return res.status(400).json({ error: safeClientError(err, 'Invalid failover configuration') });
      }
      console.error('[POST /ai-profiles]', err);
      return res.status(500).json({ error: 'Failed to create AI profile' });
    }
  },
);

/* ================================================================
   GET /api/ai-profiles/default — get the current default profile
   (MUST be registered before /:id so Express doesn't match "default" as an ID)
   ================================================================ */

router.get('/default', async (req: Request, res: Response) => {
  try {
    const profile = await getDefaultAiProfile();
    if (!profile) return res.json(null);
    return res.json(profile);
  } catch (err) {
    console.error('[GET /ai-profiles/default]', err);
    return res.status(500).json({ error: 'Failed to retrieve default AI profile' });
  }
});

/* ================================================================
   GET /api/ai-profiles/:id
   ================================================================ */

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const row = await getAiProfile(req.params.id as string);
    return res.json(stripSecrets(row));
  } catch (_err) {
    return res.status(404).json({ error: 'AI Profile not found' });
  }
});

/* ================================================================
   PUT /api/ai-profiles/:id
   ================================================================ */

const PROFILE_UPDATABLE_FIELDS = new Set([
  'provider_id',
  'external_ai_id',
  'failover_provider_id',
  'failover_external_ai_id',
  'failover_runtime_options',
  'name',
  'description',
  'is_active',
  'profile_type',
  'mode',
  'runtime_options',
  'config',
]);

router.put(
  '/:id',
  requireRole('owner', 'admin'),
  validateBody(updateAiProfileSchema),
  async (req: Request, res: Response) => {
    try {
      /* Handle the is_default flag with the only-one-default pattern */
      if (req.body.is_default === true) {
        await setDefaultAiProfile(req.params.id as string);
      } else if (req.body.is_default === false) {
        await clearDefaultAiProfile(req.params.id as string);
      }

      /* Allow-list: only permit known fields into the DB update */
      const otherUpdates: Record<string, unknown> = {};
      for (const key of Object.keys(req.body)) {
        if (PROFILE_UPDATABLE_FIELDS.has(key)) otherUpdates[key] = req.body[key];
      }
      const hasOtherUpdates = Object.keys(otherUpdates).length > 0;

      if (hasOtherUpdates) {
        if ('provider_id' in otherUpdates || 'profile_type' in otherUpdates || 'mode' in otherUpdates) {
          const current = await getAiProfile(req.params.id as string);
          const providerId = (otherUpdates.provider_id as string | undefined) || current.provider_id;
          if (providerId) {
            const provider = await getProvider(providerId);
            if (provider?.type === 'google-gemini') {
              otherUpdates.profile_type = 'model';
            }
          }
        }
        if ('failover_provider_id' in otherUpdates || 'failover_external_ai_id' in otherUpdates) {
          const failover = normaliseFailoverFields(
            otherUpdates.failover_provider_id,
            otherUpdates.failover_external_ai_id,
          );
          if (failover.failover_provider_id) {
            const fp = await getProvider(failover.failover_provider_id);
            if (!fp)
              return res.status(400).json({ error: `Failover provider ${failover.failover_provider_id} not found` });
          }
          Object.assign(otherUpdates, failover);
        }
        if ('runtime_options' in otherUpdates || 'provider_id' in otherUpdates) {
          const current = await getAiProfile(req.params.id as string);
          const providerId = (otherUpdates.provider_id as string | undefined) || current.provider_id;
          const provider = providerId ? await getProvider(providerId) : null;
          otherUpdates.runtime_options = normaliseAiProfileRuntimeOptions(
            provider?.type || current?.provider?.type,
            (otherUpdates.runtime_options as Record<string, unknown> | undefined) ??
              current.runtime_options ??
              undefined,
          );
        }
        const updated = await updateAiProfile(req.params.id as string, otherUpdates);
        return res.json(updated);
      }

      /* If only is_default was changed, return the refreshed profile */
      const refreshed = await getAiProfile(req.params.id as string);
      return res.json(refreshed);
    } catch (err) {
      if (errorMessage(err).includes('failover_provider_id') || errorMessage(err).includes('failover_external_ai_id')) {
        return res.status(400).json({ error: safeClientError(err, 'Invalid failover configuration') });
      }
      console.error('[PUT /ai-profiles/:id]', err);
      return res.status(500).json({ error: 'Failed to update AI profile' });
    }
  },
);

/* ================================================================
   DELETE /api/ai-profiles/:id
   ================================================================ */

router.delete('/:id', requireRole('owner', 'admin'), async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    const { listProcessingJobs } = await import('../models/processing-jobs.ts');
    const jobs = await listProcessingJobs({ limit: 200 });
    const dependents = (jobs || []).filter((j: ProcessingJobRow) => j.ai_profile_id === id);
    if (dependents.length > 0) {
      return res.status(409).json({
        error: `Cannot delete: ${dependents.length} processing job(s) reference this AI profile`,
        dependents: dependents.map((j: ProcessingJobRow) => ({ id: j.id, name: j.name, slug: j.slug })),
      });
    }
    await deleteAiProfile(id);
    return res.status(204).end();
  } catch (err) {
    console.error('[DELETE /ai-profiles/:id]', err);
    return res.status(500).json({ error: 'Failed to delete AI profile' });
  }
});

/* ================================================================
   POST /api/ai-profiles/:id/test-chat  — test chat with this AI
   Sends a user message and returns the raw AI response.
   ================================================================ */

router.post(
  '/:id/test-chat',
  requireRole('owner', 'admin'),
  validateBody(testChatSchema),
  async (req: Request, res: Response) => {
    try {
      const { message, systemPrompt } = req.body;

      const profile = await getAiProfileWithKeys(req.params.id as string);
      if (!profile?.provider) {
        return res.status(400).json({ error: 'AI profile has no linked provider' });
      }

      const provider = profile.provider;
      const client = createLlmClientForProvider(provider);
      const chatOptions = buildProviderChatOptions(provider.type, profile.runtime_options ?? undefined);

      const messages: ChatMessage[] = [];
      if (systemPrompt) {
        messages.push({ role: 'system', content: systemPrompt });
      }
      messages.push({ role: 'user', content: message });

      const primaryModel = profile.external_ai_id;
      const failoverProvider = profile.failover_provider;
      const failoverAiId = String(profile.failover_external_ai_id || '').trim();
      const hasFailover = failoverProvider && failoverAiId;

      const timeoutMs = await resolveTestChatTimeout(provider);

      const t0 = Date.now();
      let modelUsed = primaryModel;
      let failoverUsed = false;
      let data: ChatCompletionResponse | null = null;
      let content = '';

      try {
        data = await client.chatCompletion(primaryModel, messages, { ...chatOptions, timeoutMs });
        content = data.choices?.[0]?.message?.content || '';
        if (!String(content || '').trim()) {
          throw new Error(`Primary model "${primaryModel}" returned empty response content`);
        }
      } catch (primaryErr) {
        if (!hasFailover) throw primaryErr;
        const foClient = createLlmClientForProvider(failoverProvider);
        const foRuntimeOpts = (profile.failover_runtime_options || profile.runtime_options) ?? undefined;
        const foChatOpts = buildProviderChatOptions(failoverProvider.type, foRuntimeOpts);
        const foTimeoutMs = await resolveTestChatTimeout(failoverProvider);
        data = await foClient.chatCompletion(failoverAiId, messages, { ...foChatOpts, timeoutMs: foTimeoutMs });
        content = data.choices?.[0]?.message?.content || '';
        if (!String(content || '').trim()) {
          throw new Error(
            `Primary model "${primaryModel}" failed and failover "${failoverAiId}" on "${failoverProvider.name}" returned empty`,
            { cause: primaryErr },
          );
        }
        modelUsed = failoverAiId;
        failoverUsed = true;
      }

      const durationMs = Date.now() - t0;

      return res.json({
        content,
        durationMs,
        model: data.model || modelUsed,
        failoverUsed,
        usage: data.usage,
        finishReason: data.choices?.[0]?.finish_reason,
      });
    } catch (err) {
      console.error('[POST /ai-profiles/:id/test-chat]', err);
      return res.status(500).json({ error: 'Test chat failed' });
    }
  },
);

/* ================================================================
   Tool Discovery & MCP OAuth — Devs.ai only
   These endpoints proxy Devs.ai tool APIs using the authenticated
   user's personal API key when available.
   ================================================================ */

/**
 * Resolve a DevsAiClient scoped to the current user for an AI profile.
 * Uses the user's personal API key if one exists, otherwise the provider key.
 */
async function resolveDevsAiClient(profileId: string): Promise<{
  client: Awaited<ReturnType<typeof createDevsAiClientForUser>>;
  aiId: string;
  profile: AiProfileRow;
  provider: ProviderRow;
}> {
  const profile = await getAiProfileWithKeys(profileId);
  if (!profile?.provider) throw new Error('AI profile has no linked provider');
  const provider = profile.provider;
  if (String(provider.type || '').toLowerCase() !== 'devs-ai') {
    throw Object.assign(new Error('Tool discovery is only supported for Devs.ai providers'), { status: 400 });
  }
  const aiId = String(profile.external_ai_id || '').trim();
  if (!aiId) throw Object.assign(new Error('AI profile has no external_ai_id'), { status: 400 });

  const ctx = getAuthContext();
  const userId = effectiveUserId(ctx);
  const client = await createDevsAiClientForUser(provider, userId);
  return { client, aiId, profile, provider };
}

/* ── GET /api/ai-profiles/:id/tools ─────────────────────────── */

router.get('/:id/tools', async (req: Request, res: Response) => {
  try {
    const { client, aiId } = await resolveDevsAiClient(req.params.id as string);
    const tools = await client.listTools(aiId);
    return res.json(Array.isArray(tools) ? tools : []);
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    console.error('[GET /ai-profiles/:id/tools]', err);
    return res.status(status).json({ error: safeStatusError(err, status, 'Failed to list tools') });
  }
});

/* ── GET /api/ai-profiles/:id/tools/mcp ─────────────────────── */

router.get('/:id/tools/mcp', async (req: Request, res: Response) => {
  try {
    const { client, aiId } = await resolveDevsAiClient(req.params.id as string);
    const tools = await client.listMcpTools(aiId);
    return res.json(Array.isArray(tools) ? tools : []);
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    console.error('[GET /ai-profiles/:id/tools/mcp]', err);
    return res.status(status).json({ error: safeStatusError(err, status, 'Failed to list MCP tools') });
  }
});

/* ── GET /api/ai-profiles/:id/tools/auth-status ─────────────── */

router.get('/:id/tools/auth-status', async (req: Request, res: Response) => {
  try {
    const { client, aiId } = await resolveDevsAiClient(req.params.id as string);
    const status = await client.listToolAuthStatus(aiId);
    return res.json(Array.isArray(status) ? status : []);
  } catch (err) {
    const httpStatus = (err as { status?: number }).status || 500;
    console.error('[GET /ai-profiles/:id/tools/auth-status]', err);
    return res.status(httpStatus).json({ error: safeStatusError(err, httpStatus, 'Failed to check tool auth status') });
  }
});

/* ── GET /api/ai-profiles/:id/tools/:toolId/oauth-status ───── */

router.get('/:id/tools/:toolId/oauth-status', async (req: Request, res: Response) => {
  try {
    const { client } = await resolveDevsAiClient(req.params.id as string);
    const result = await client.getToolOAuthStatus(req.params.toolId as string);
    return res.json(result);
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    console.error('[GET /ai-profiles/:id/tools/:toolId/oauth-status]', err);
    return res.status(status).json({ error: safeStatusError(err, status, 'Failed to get OAuth status') });
  }
});

/* ── POST /api/ai-profiles/:id/tools/:toolId/oauth-initiate ── */

router.post('/:id/tools/:toolId/oauth-initiate', requireRole('owner', 'admin'), async (req: Request, res: Response) => {
  try {
    const { client } = await resolveDevsAiClient(req.params.id as string);
    const result = await client.initiateToolOAuth(req.params.toolId as string);
    return res.json(result);
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    console.error('[POST /ai-profiles/:id/tools/:toolId/oauth-initiate]', err);
    return res.status(status).json({ error: safeStatusError(err, status, 'Failed to initiate OAuth') });
  }
});

/* ── DELETE /api/ai-profiles/:id/tools/:toolId/oauth-token ─── */

router.delete('/:id/tools/:toolId/oauth-token', requireRole('owner', 'admin'), async (req: Request, res: Response) => {
  try {
    const { client } = await resolveDevsAiClient(req.params.id as string);
    await client.deleteToolOAuthToken(req.params.toolId as string);
    return res.status(204).end();
  } catch (err) {
    const status = (err as { status?: number }).status || 500;
    console.error('[DELETE /ai-profiles/:id/tools/:toolId/oauth-token]', err);
    return res.status(status).json({ error: safeStatusError(err, status, 'Failed to delete OAuth token') });
  }
});

export default router;
