/**
 * Context pack builder (MEMORY-ARCHITECTURE.md §4.3–4.4).
 *
 * P2 as revised 2026-08-31: the Broker SELECTS, the app RENDERS.
 *   1. pack-select : reads the catalog (functions + data stats) → chooses which retrieval
 *                    functions to call. The app validates the choice against the registry
 *                    and EXECUTES them (the semantic layer; the model never touches the DB).
 *                    Falls back to the deterministic per-intent list if the Broker fails.
 *   2. render      : each function's own render() — deterministic, word for word what the
 *                    data says.
 *
 * There used to be a step 2½ — a pack-summarize job that rewrote the executed results into
 * prose — and it is deliberately GONE. On 2026-08-31 it asserted "No linked equipment or
 * tracked measures … noted" about a domain it had never been handed (equipment was not in the
 * selection), and in the same pack it dropped the consistency figure while find_tools was
 * telling the coach she "already had" it. A summarizer between structured facts and the model
 * can invent absences and lose numbers; the render() strings are the facts, cost no job call,
 * and are the same strings the per-turn path hashes for its freshness markers. Facts small
 * enough to inject verbatim are injected verbatim — selection controls size, not compression.
 *
 * The pack is persisted with provenance (which functions ran, the select reason, the mode)
 * and injected as the end-of-prefix context turn.
 */
import type { CoachIntent, CoachTopic } from './coach-context.ts';
import { intentFraming, onboardingReadiness, planGapNote, targetlessGoalNote } from './coach-context.ts';
import { RETRIEVAL_FUNCTIONS } from './retrieval/registry.ts';
import { validateCalls, executeCalls, type FnCall } from './retrieval/select-and-run.ts';
import { renderCatalogDoc } from './retrieval/catalog.ts';
import { ctxMarker } from './turn-context-memory.ts';
import { runJobBySlug } from '../ai/aim.ts';
import { getFreshContextPack, insertContextPack, type ProvenanceEntry } from '../repos/context-pack.ts';
import { updateTrace } from './dev-trace.ts';
import { logAi } from './ai-log.ts';

/** Deterministic fallback selection per intent (used only if the Broker select fails). */
const INTENT_SELECTION: Record<CoachIntent, string[]> = {
  onboarding: ['get_identity', 'get_objectives', 'get_constraints', 'get_equipment', 'get_health_history'],
  initial: ['get_identity', 'get_objectives', 'get_active_plan', 'get_constraints', 'get_dietary_profile'],
  ongoing: [
    'get_identity',
    'get_objectives',
    'get_active_plan',
    'get_consistency',
    'get_constraints',
    'get_weight',
    'get_dietary_profile',
    // What their devices saw, plan or no plan — a coach who has to be TOLD about workouts her
    // own tools recorded is the owner's "should know before the user says" failure, verbatim.
    'get_health_history',
    // What they own — absent from this list on 2026-08-31, which is half of how the coach came
    // to deny the owner's dumbbells (the other half was the summarizer asserting the absence).
    'get_equipment',
  ],
  disrupted: [
    'get_identity',
    'get_objectives',
    'get_active_plan',
    'get_constraints',
    'get_equipment',
    'get_dietary_profile',
  ],
};

/**
 * Functions ALWAYS retrieved, regardless of the Broker's selection. Identity and constraints are
 * safety-critical; weight joined them 2026-08-14 after the pack-select pass CHOSE a list without
 * it and the coach asked someone their weight fifteen minutes after the Broker captured it. Body
 * facts cost ~20 tokens and their absence costs the product's core promise ("never makes you
 * repeat yourself") — that is not a trade a model gets to optimize.
 *
 * Equipment joined 2026-08-31 for the weight story replayed: the select chose an ongoing list
 * without it, and the coach spent a session unaware of the dumbbells the user had told her about
 * that morning ("all of my equipment has disappeared from her memory"). A handful of owned items
 * renders in ~30 tokens.
 */
const MANDATORY = ['get_identity', 'get_constraints', 'get_weight', 'get_equipment'];

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

/** Step 1: Broker chooses functions from the catalog. Returns null on any failure. */
async function brokerSelect(userId: string, intent: CoachIntent): Promise<{ calls: FnCall[]; reason: string } | null> {
  try {
    const catalog = await renderCatalogDoc(userId);
    const res = await runJobBySlug(userId, 'pack-select', { intent, catalog });
    const parsed = JSON.parse(res.formatted ?? res.raw ?? '{}') as { calls?: unknown; reason?: unknown };
    const calls = validateCalls(parsed.calls);
    if (!calls.length) return null;
    return { calls, reason: typeof parsed.reason === 'string' ? parsed.reason : '' };
  } catch (e) {
    console.error('[pack-select] failed, falling back to deterministic selection:', e);
    return null;
  }
}

/** Deterministic render of executed results — the pack body (see the file header for why no
 *  summarizer stands between these strings and the coach). */
function renderResults(results: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [fn, result] of Object.entries(results)) {
    if (fn === 'onboarding_readiness') {
      if (result) parts.push(`Onboarding readiness:\n${String(result)}`);
      continue;
    }
    if (fn === 'plan_gap') {
      if (result) parts.push(String(result));
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
  // REUSE (P3): a fresh-enough pack whose user has written NOTHING dossier-relevant since it was
  // built is served as-is — zero Broker calls. Freshness is decided in SQL against the trigger
  // watermark (migration 0022), so no app code has to remember to invalidate anything. The stored
  // row already carries the audit trail; a reuse inserts nothing.
  const cached = await getFreshContextPack(userId, topic ?? null, intent);
  if (cached) {
    updateTrace(userId, {
      context: {
        mode: 'pack-reuse',
        selectReason: `reused pack built ${cached.builtAt} — no dossier writes since`,
        provenance: cached.provenance,
        data: {},
        rendered: cached.rendered,
      },
      brokerSelect: null,
      brokerSummarize: null,
    });
    void logAi(userId, { kind: 'pack_reuse', output: { packId: cached.id }, meta: { builtAt: cached.builtAt } });
    return {
      id: cached.id,
      rendered: cached.rendered,
      provenance: cached.provenance,
      mode: 'pack-reuse',
      selectReason: 'fresh pack — no dossier writes since',
      builtAt: cached.builtAt,
      expiresAt: cached.expiresAt,
    };
  }

  const now = new Date();
  const builtAt = now.toISOString();
  const ttlDays = TTL_DAYS[intent] ?? 7;
  const expiresAt = new Date(now.getTime() + ttlDays * 86_400_000).toISOString();

  // 1. SELECT — Broker, with deterministic fallback.
  const sel = await brokerSelect(userId, intent);
  const usedScribeSelect = sel !== null;
  const calls: FnCall[] =
    sel?.calls ?? (INTENT_SELECTION[intent] ?? INTENT_SELECTION.ongoing).map((fn) => ({ fn, params: {} }));
  // Safety net: always retrieve identity + constraints even if the Broker didn't pick them.
  const have = new Set(calls.map((c) => c.fn));
  for (const m of MANDATORY) if (!have.has(m) && RETRIEVAL_FUNCTIONS[m]) calls.push({ fn: m, params: {} });
  const selectReason = sel?.reason || '(deterministic selection)';

  // 2. EXECUTE — the semantic layer, governed app-side (model never runs queries).
  const { results, provenance } = await executeCalls(userId, calls, {
    at: builtAt,
    logLabel: 'context-pack',
  });
  if (intent === 'onboarding') results.onboarding_readiness = await onboardingReadiness(userId);
  // The stranded-goal healer rides every non-onboarding pack: agreed-but-unplanned goals stay in
  // front of the coach until they are built or let go (see coach-context.planGapNote).
  if (intent !== 'onboarding') {
    const gap = await planGapNote(userId).catch(() => '');
    if (gap) results.plan_gap = gap;
    // Same standing as the plan gap: a weight goal with no number, and a calorie target still
    // being earned, stay in front of the coach until they are resolved (owner 2026-08-18).
    const numbers = await targetlessGoalNote(userId).catch(() => '');
    if (numbers) results.nutrition_numbers_gap = numbers;
  }

  // 3. RENDER — deterministic, word for word what each function's render() says. The summarize
  // job that used to sit here is gone on purpose (file header, 2026-08-31): it asserted an
  // absence it never checked and dropped a number it was handed.
  const summary = renderResults(results);

  // 4. Compose + persist (provenance + mode + reason are the audit trail).
  // Mode string values keep the historical `broker-*` prefix (persisted audit trail); DevTrace
  // field names use the canonical Broker name (CROSS-01 / BRAND.md). 'broker-select' is the
  // post-2026-08-31 vocabulary: the Broker chose the functions, the app rendered the words.
  const mode = usedScribeSelect ? 'broker-select' : 'deterministic';
  const header = `[context built ${builtAt.slice(0, 10)} · ${mode} · fns: ${provenance.map((p) => p.fn).join(', ') || 'none'}${selectReason ? ` · why: ${selectReason}` : ''}]`;
  /**
   * Freshness markers for everything this pack already put in front of her.
   *
   * `turn-context-memory.ts` lets a later turn tell "she already has this" from "this is news", by
   * looking back through the session for a `[ctx:fn:hash]` marker. Only the PER-TURN path was
   * emitting them, so the very first thing she is ever told — this pack — was invisible to that
   * check: retrieving the same health history two turns later found no marker, classified it
   * `new`, and she read the user their own numbers a second time. That is the repetition the
   * markers were introduced to stop, arriving by the one route they did not cover.
   *
   * Still their own line even now that the body IS the render strings: the body joins several
   * functions' renders into one block, and the marker hash must be per-fn over `f.render(result)`
   * — the identical function the turn path calls — so identical data produces an identical marker.
   */
  const marks = Object.entries(results)
    .map(([fn, result]) => {
      const r = RETRIEVAL_FUNCTIONS[fn]?.render(result);
      return r ? ctxMarker(fn, r) : null;
    })
    .filter(Boolean)
    .join(' ');
  const rendered = [intentFraming(intent, topic), '', header, '', summary, ...(marks ? ['', marks] : [])].join('\n');

  // Dev X-ray: record what was pulled + how it was curated (no effect on the coaching path).
  updateTrace(userId, {
    context: { mode, selectReason, provenance, data: results, rendered },
    brokerSelect: sel ? { calls: sel.calls, reason: sel.reason } : null,
    brokerSummarize: null,
  });
  // Durable log: the Broker's select, and the rendered body (same kind as before so the X-ray's
  // history reads through the 2026-08-31 change; meta.mode says which era a row belongs to).
  void logAi(userId, { kind: 'pack_select', input: { intent }, output: sel ?? { fallback: true }, meta: { mode } });
  void logAi(userId, { kind: 'pack_summarize', output: { summary }, meta: { mode } });

  const id = await insertContextPack({
    userId,
    topic: topic ?? null,
    sections: { summary, select_reason: selectReason, mode, intent },
    rendered,
    provenance,
    tokenEstimate: Math.ceil(rendered.length / 4),
    expiresAt,
  });

  return { id, rendered, provenance, mode, selectReason, builtAt, expiresAt };
}
