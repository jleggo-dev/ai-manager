/**
 * Context pack builder (MEMORY-ARCHITECTURE.md §4.3–4.4).
 *
 * P2: the Scribe CURATES the pack via two auditable AI Admin jobs —
 *   1. pack-select   : reads the catalog (functions + data stats) → chooses which retrieval
 *                      functions to call. The app validates the choice against the registry
 *                      and EXECUTES them (the semantic layer; the model never touches the DB).
 *   2. pack-summarize: turns the executed results into a compact grounding block.
 * Each step falls back to the deterministic P1 path if the Scribe fails, so the coach never
 * breaks. The pack is persisted with provenance (which functions ran, the select reason, the
 * mode) and injected as the end-of-prefix context turn.
 */
import type { CoachIntent, CoachTopic } from './coach-context.ts';
import { intentFraming, onboardingReadiness } from './coach-context.ts';
import { RETRIEVAL_FUNCTIONS } from './retrieval/registry.ts';
import { renderCatalogDoc } from './retrieval/catalog.ts';
import { runJobBySlug } from '../ai/aim.ts';
import { insertContextPack, type ProvenanceEntry } from '../repos/context-pack.ts';
import { updateTrace } from './dev-trace.ts';
import { logAi } from './ai-log.ts';

/** Deterministic fallback selection per intent (used only if the Scribe select fails). */
const INTENT_SELECTION: Record<CoachIntent, string[]> = {
  onboarding: ['get_identity', 'get_objectives', 'get_constraints', 'get_equipment'],
  initial: ['get_identity', 'get_objectives', 'get_active_plan', 'get_constraints'],
  ongoing: ['get_identity', 'get_objectives', 'get_active_plan', 'get_consistency', 'get_constraints', 'get_weight'],
  disrupted: ['get_identity', 'get_objectives', 'get_active_plan', 'get_constraints', 'get_equipment'],
};

/** Safety-critical functions ALWAYS retrieved, regardless of the Scribe's selection. */
const MANDATORY = ['get_identity', 'get_constraints'];

const TTL_DAYS: Partial<Record<CoachIntent, number>> = { onboarding: 1 };

export interface ContextPack {
  id: string | null;
  rendered: string;
  provenance: ProvenanceEntry[];
  mode: string;
  selectReason: string;
  builtAt: string;
  expiresAt: string;
}

interface FnCall {
  fn: string;
  params: Record<string, unknown>;
}

/** Step 1: Scribe chooses functions from the catalog. Returns null on any failure. */
async function scribeSelect(userId: string, intent: CoachIntent): Promise<{ calls: FnCall[]; reason: string } | null> {
  try {
    const catalog = await renderCatalogDoc(userId);
    const res = await runJobBySlug(userId, 'pack-select', { intent, catalog });
    const parsed = JSON.parse(res.formatted ?? res.raw ?? '{}') as { calls?: unknown; reason?: unknown };
    const raw = Array.isArray(parsed.calls) ? parsed.calls : [];
    const calls: FnCall[] = raw
      .filter(
        (c): c is { fn: string; params?: unknown } =>
          !!c && typeof (c as { fn?: unknown }).fn === 'string' && !!RETRIEVAL_FUNCTIONS[(c as { fn: string }).fn],
      )
      .map((c) => ({
        fn: c.fn,
        params: c.params && typeof c.params === 'object' ? (c.params as Record<string, unknown>) : {},
      }));
    if (!calls.length) return null;
    return { calls, reason: typeof parsed.reason === 'string' ? parsed.reason : '' };
  } catch (e) {
    console.error('[pack-select] failed, falling back to deterministic selection:', e);
    return null;
  }
}

/** Step 2: Scribe summarizes the executed results into a grounding block. Null on failure. */
async function scribeSummarize(
  userId: string,
  intent: CoachIntent,
  results: Record<string, unknown>,
): Promise<string | null> {
  try {
    const res = await runJobBySlug(userId, 'pack-summarize', { intent, results: JSON.stringify(results) });
    const text = (res.formatted ?? res.raw ?? '').trim();
    return text || null;
  } catch (e) {
    console.error('[pack-summarize] failed, falling back to deterministic render:', e);
    return null;
  }
}

/** Deterministic render of executed results (the P1 fallback for summarization). */
function renderResults(results: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [fn, result] of Object.entries(results)) {
    if (fn === 'onboarding_readiness') {
      if (result) parts.push(`Onboarding readiness:\n${String(result)}`);
      continue;
    }
    const f = RETRIEVAL_FUNCTIONS[fn];
    if (f) {
      const s = f.render(result);
      if (s) parts.push(s);
    }
  }
  return parts.join('\n\n') || '(nothing captured yet)';
}

export async function buildContextPack(
  userId: string,
  intent: CoachIntent = 'ongoing',
  topic?: CoachTopic,
): Promise<ContextPack> {
  const now = new Date();
  const builtAt = now.toISOString();
  const ttlDays = TTL_DAYS[intent] ?? 7;
  const expiresAt = new Date(now.getTime() + ttlDays * 86_400_000).toISOString();

  // 1. SELECT — Scribe, with deterministic fallback.
  const sel = await scribeSelect(userId, intent);
  const usedScribeSelect = sel !== null;
  const calls: FnCall[] =
    sel?.calls ?? (INTENT_SELECTION[intent] ?? INTENT_SELECTION.ongoing).map((fn) => ({ fn, params: {} }));
  // Safety net: always retrieve identity + constraints even if the Scribe didn't pick them.
  const have = new Set(calls.map((c) => c.fn));
  for (const m of MANDATORY) if (!have.has(m) && RETRIEVAL_FUNCTIONS[m]) calls.push({ fn: m, params: {} });
  const selectReason = sel?.reason || '(deterministic selection)';

  // 2. EXECUTE — the semantic layer, governed app-side (model never runs queries).
  const results: Record<string, unknown> = {};
  const provenance: ProvenanceEntry[] = [];
  for (const { fn, params } of calls) {
    const f = RETRIEVAL_FUNCTIONS[fn];
    if (!f) continue;
    try {
      const result = await f.run(userId, params);
      results[fn] = result;
      provenance.push({ fn, params, rows: f.rows(result), at: builtAt });
    } catch (e) {
      console.error(`[context-pack] ${fn} failed:`, e);
    }
  }
  if (intent === 'onboarding') results.onboarding_readiness = await onboardingReadiness(userId);

  // 3. SUMMARIZE — Scribe, with deterministic fallback.
  const scribeSummary = await scribeSummarize(userId, intent, results);
  const usedScribeSummary = scribeSummary !== null;
  const summary = scribeSummary ?? renderResults(results);

  // 4. Compose + persist (provenance + mode + reason are the audit trail).
  // Mode string values keep the historical `broker-*` prefix (persisted audit trail); DevTrace
  // field names use the canonical Scribe name (CROSS-01 / BRAND.md).
  const mode =
    usedScribeSelect && usedScribeSummary
      ? 'broker-curated'
      : usedScribeSelect || usedScribeSummary
        ? 'broker-partial'
        : 'deterministic';
  const header = `[context built ${builtAt.slice(0, 10)} · ${mode} · fns: ${provenance.map((p) => p.fn).join(', ') || 'none'}${selectReason ? ` · why: ${selectReason}` : ''}]`;
  const rendered = [intentFraming(intent, topic), '', header, '', summary].join('\n');

  // Dev X-ray: record what was pulled + how it was curated (no effect on the coaching path).
  updateTrace(userId, {
    context: { mode, selectReason, provenance, data: results, rendered },
    scribeSelect: sel ? { calls: sel.calls, reason: sel.reason } : null,
    scribeSummarize: scribeSummary ? { output: scribeSummary } : null,
  });
  // Durable log of the two Scribe steps.
  void logAi(userId, { kind: 'pack_select', input: { intent }, output: sel ?? { fallback: true }, meta: { mode } });
  void logAi(userId, { kind: 'pack_summarize', output: { summary }, meta: { mode } });

  const id = await insertContextPack({
    userId,
    topic: topic ?? null,
    sections: { summary, select_reason: selectReason, mode },
    rendered,
    provenance,
    tokenEstimate: Math.ceil(rendered.length / 4),
    expiresAt,
  });

  return { id, rendered, provenance, mode, selectReason, builtAt, expiresAt };
}
