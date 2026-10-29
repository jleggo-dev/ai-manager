/**
 * Model liveness — does each configured model actually answer?
 *
 * The model catalog (`GET /api/v1/models`, synced into `llm_models`) is a LISTING, not a promise.
 * On 2026-10-27 Devs.ai kept listing six models as active while answering 400
 * "Model X is not available for this request" to a one-line prompt. Three Cadence profiles were
 * dead on both pointers (primary and failover from the same family) and nothing in AI Admin said
 * so: the provider "test" only lists models, the catalog refresh only reads the listing.
 *
 * This service sends ONE minimal completion per distinct model a provider's active profiles point
 * at (primary and failover) and records a verdict per model: answers / refused (with the
 * provider's own words) / timed out / answered empty / error. Profiles are then marked from the
 * model verdicts, so a dead pointer is visible on the profile that uses it.
 *
 * Cheap by construction: one call per distinct model, never per profile, and only when asked.
 * Nothing here repoints a profile — `apps/cadence-api/scripts/repoint-profile.ts` does that.
 */

import type { AiProfileRow, ChatMessage, ProviderRow } from '../types.ts';

export type LivenessVerdict = 'ok' | 'refused' | 'timeout' | 'empty' | 'error' | 'skipped';

export interface ModelLiveness {
  model: string;
  verdict: LivenessVerdict;
  /** The provider's own words for a refusal or error; a plain reason for empty/skipped. */
  message: string | null;
  duration_ms: number;
}

export interface ProfilePointerLiveness {
  model: string;
  verdict: LivenessVerdict;
}

export interface ProfileLiveness {
  id: string;
  name: string;
  primary: ProfilePointerLiveness | null;
  failover: ProfilePointerLiveness | null;
  /** True when the primary or the failover on THIS provider does not answer. */
  dead: boolean;
}

export interface ProviderLivenessReport {
  provider_id: string;
  provider_name: string;
  checked_at: string;
  duration_ms: number;
  models: ModelLiveness[];
  profiles: ProfileLiveness[];
}

/** The slice of the provider clients the check needs — every client in client-factory has it. */
export interface LivenessClient {
  chatCompletion(
    model: string,
    messages: ChatMessage[],
    options?: Record<string, unknown>,
  ): Promise<{ choices?: Array<{ message?: { content?: unknown } }> }>;
}

export interface LivenessOptions {
  timeoutMs?: number;
  /** How many models are in flight at once. */
  concurrency?: number;
}

const PROMPT = 'Reply with the single word OK.';
/** Chat-class models answer in a handful of tokens. */
const SMALL_OUTPUT_BUDGET = 32;
/** Reasoning-class models (gpt-5 family, o-series) spend the budget thinking and return empty below ~400. */
const REASONING_OUTPUT_BUDGET = 450;
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_CONCURRENCY = 4;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REASONING_MODEL_RE = /(^|[-/])(gpt-5|o[1-9]|.*-thinking|.*-reasoning)/i;

export function outputBudgetFor(model: string): number {
  return REASONING_MODEL_RE.test(model) ? REASONING_OUTPUT_BUDGET : SMALL_OUTPUT_BUDGET;
}

/** A devs-ai v1 AGENT pointer is a UUID, not a model id; a completion call cannot prove it. */
export function isAgentPointer(pointer: string): boolean {
  return UUID_RE.test(String(pointer || '').trim());
}

/** Per-provider-type spelling of the output cap; Gemini's client takes none. */
function completionOptions(providerType: string, model: string, timeoutMs: number): Record<string, unknown> {
  const budget = outputBudgetFor(model);
  if (providerType === 'devs-ai-v2') return { max_output_tokens: budget, store: false, timeoutMs };
  if (providerType === 'devs-ai') return { max_tokens: budget, timeoutMs };
  return { timeoutMs };
}

/**
 * Pull the provider's own words out of a client error. The clients throw
 * `Devs.ai v2 API error (400): {"error":{"message":"Model X is not available ..."}}` and
 * `Google Gemini request failed: <detail>`; the status, when present, decides refused vs error.
 */
export function classifyError(err: unknown): { verdict: LivenessVerdict; message: string } {
  const raw = err instanceof Error ? err.message : String(err);
  if (/timed out|timeout/i.test(raw)) return { verdict: 'timeout', message: raw };

  const statusMatch = raw.match(/\((\d{3})\)/);
  const status = statusMatch ? Number(statusMatch[1]) : null;
  const afterStatus = statusMatch ? raw.slice(raw.indexOf(statusMatch[0]) + statusMatch[0].length) : raw;
  const body = afterStatus.replace(/^[:\s]+/, '').trim();

  let message = body;
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const inner = parsed.error as Record<string, unknown> | string | undefined;
    const candidate =
      (typeof inner === 'object' && inner && typeof inner.message === 'string' && inner.message) ||
      (typeof inner === 'string' && inner) ||
      (typeof parsed.message === 'string' && parsed.message) ||
      null;
    if (candidate) message = candidate;
  } catch {
    /* not JSON — the text is the message */
  }

  const refused = status !== null && status >= 400 && status < 500 && status !== 408 && status !== 429;
  return { verdict: refused ? 'refused' : 'error', message: message || raw };
}

function contentText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((p) =>
        p && typeof p === 'object' && typeof (p as { text?: unknown }).text === 'string'
          ? (p as { text: string }).text
          : '',
      )
      .join('');
  }
  return '';
}

/** One minimal completion for one model, never throws. */
export async function checkModel(
  client: LivenessClient,
  providerType: string,
  model: string,
  timeoutMs: number,
): Promise<ModelLiveness> {
  if (isAgentPointer(model)) {
    return {
      model,
      verdict: 'skipped',
      message: 'an agent id, not a model — only model ids are checked',
      duration_ms: 0,
    };
  }
  const started = Date.now();
  try {
    const res = await client.chatCompletion(
      model,
      [{ role: 'user', content: PROMPT }],
      completionOptions(providerType, model, timeoutMs),
    );
    const text = contentText(res?.choices?.[0]?.message?.content).trim();
    const duration_ms = Date.now() - started;
    if (!text) {
      return {
        model,
        verdict: 'empty',
        message: 'answered with no text — a reasoning model needs a larger output budget',
        duration_ms,
      };
    }
    return { model, verdict: 'ok', message: null, duration_ms };
  } catch (err) {
    const { verdict, message } = classifyError(err);
    return { model, verdict, message, duration_ms: Date.now() - started };
  }
}

/** The distinct models this provider's active profiles point at, primary and failover. */
export function modelsPointedAt(providerId: string, profiles: AiProfileRow[]): string[] {
  const set = new Set<string>();
  for (const p of profiles) {
    if (!p.is_active) continue;
    if (p.provider_id === providerId && p.external_ai_id) set.add(p.external_ai_id.trim());
    if (p.failover_provider_id === providerId && p.failover_external_ai_id) set.add(p.failover_external_ai_id.trim());
  }
  return [...set].filter(Boolean).sort();
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

const NOT_ANSWERING: ReadonlySet<LivenessVerdict> = new Set(['refused', 'timeout', 'empty', 'error']);

/** Mark each active profile from the model verdicts. Pointers on another provider are left null. */
export function markProfiles(providerId: string, profiles: AiProfileRow[], models: ModelLiveness[]): ProfileLiveness[] {
  const byModel = new Map(models.map((m) => [m.model, m.verdict]));
  const pointer = (pid: string | null | undefined, model: string | null | undefined): ProfilePointerLiveness | null => {
    if (pid !== providerId || !model) return null;
    const key = model.trim();
    return { model: key, verdict: byModel.get(key) ?? 'skipped' };
  };
  return profiles
    .filter((p) => p.is_active && (p.provider_id === providerId || p.failover_provider_id === providerId))
    .map((p) => {
      const primary = pointer(p.provider_id, p.external_ai_id);
      const failover = pointer(p.failover_provider_id, p.failover_external_ai_id);
      const dead = [primary, failover].some((x) => x !== null && NOT_ANSWERING.has(x.verdict));
      return { id: p.id, name: p.name, primary, failover, dead };
    });
}

/** Run the check for one provider. `client` is whatever `createLlmClientForProvider` returns. */
export async function runProviderLiveness(
  provider: ProviderRow,
  profiles: AiProfileRow[],
  client: LivenessClient,
  options: LivenessOptions = {},
): Promise<ProviderLivenessReport> {
  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? provider.request_timeout_ms ?? DEFAULT_TIMEOUT_MS;
  const models = modelsPointedAt(provider.id, profiles);
  const results = await mapWithConcurrency(models, options.concurrency ?? DEFAULT_CONCURRENCY, (m) =>
    checkModel(client, provider.type, m, timeoutMs),
  );
  return {
    provider_id: provider.id,
    provider_name: provider.name,
    checked_at: new Date().toISOString(),
    duration_ms: Date.now() - started,
    models: results,
    profiles: markProfiles(provider.id, profiles, results),
  };
}

/** Where the last report for a provider lives in `app_settings`. */
export function livenessSettingKey(providerId: string): string {
  return `provider_liveness:${providerId}`;
}
