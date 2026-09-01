/**
 * Context pack builder (MEMORY-ARCHITECTURE.md §4.3–4.4).
 *
 * P2 as revised 2026-08-31 (second pass, same day): fully deterministic — no model in the
 * session-open path.
 *   1. select : INTENT_SELECTION[intent] (fallback: ongoing) + the MANDATORY floor. Always.
 *   2. render : each function's own render() — deterministic, word for word what the data says.
 *
 * Two Broker jobs used to stand in this file, and both are deliberately GONE:
 *
 *   - pack-summarize (removed earlier on 2026-08-31): rewrote the executed results into prose.
 *     It asserted "No linked equipment or tracked measures … noted" about a domain it had never
 *     been handed, and in the same pack dropped the consistency figure while find_tools was
 *     telling the coach she "already had" it. A summarizer between structured facts and the
 *     model can invent absences and lose numbers. Facts small enough to inject verbatim are
 *     injected verbatim — selection controls size, not compression.
 *
 *   - pack-select (removed later on 2026-08-31): read the catalog and chose which retrieval
 *     functions to run, with the deterministic lists below as its fallback. Its record: it
 *     omitted weight (2026-08-14 — the coach asked someone their weight fifteen minutes after
 *     the Broker captured it) and equipment (2026-08-31 — the coach denied the owner's
 *     dumbbells). Each omission was patched by widening MANDATORY, until the lists + floor
 *     carried everything load-bearing and the job was choosing nothing the fallback didn't —
 *     for the price of a model call at every session open. So selection went deterministic.
 *     The Broker's remaining role is capture, itself being phased down.
 *
 * The pack is persisted with provenance (which functions ran, the reason, the mode) and
 * injected as the end-of-prefix context turn.
 */
import type { CoachIntent, CoachTopic } from './coach-context.ts';
import { intentFraming, onboardingReadiness, planGapNote, targetlessGoalNote } from './coach-context.ts';
import { RETRIEVAL_FUNCTIONS } from './retrieval/registry.ts';
import { executeCalls, type FnCall } from './retrieval/select-and-run.ts';
import { ctxMarker } from './turn-context-memory.ts';
import { getFreshContextPack, insertContextPack, type ProvenanceEntry } from '../repos/context-pack.ts';
import { updateTrace } from './dev-trace.ts';
import { logAi } from './ai-log.ts';

/** THE selection, per intent (fallback: ongoing). Since 2026-08-31 no model chooses — these
 *  lists plus the MANDATORY floor are the whole select step. */
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
    // What they BUILT (Activity Builder, owner ruling 2026-09-01): informed, never approving —
    // a coach who has to be told the user built something is the dumbbells failure again.
    // Renders '' when nothing is built, so the default user pays nothing for this line.
    'get_user_built_activities',
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
 * Functions ALWAYS retrieved, whatever the per-intent list says. Identity and constraints are
 * safety-critical; weight joined them 2026-08-14 after the (since-removed) pack-select pass CHOSE
 * a list without it and the coach asked someone their weight fifteen minutes after the Broker
 * captured it. Body facts cost ~20 tokens and their absence costs the product's core promise
 * ("never makes you repeat yourself") — that is not a trade a model gets to optimize.
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

  // 1. SELECT — deterministic: the per-intent list + the MANDATORY floor (file header, 2026-08-31).
  const calls: FnCall[] = (INTENT_SELECTION[intent] ?? INTENT_SELECTION.ongoing).map((fn) => ({ fn, params: {} }));
  const have = new Set(calls.map((c) => c.fn));
  for (const m of MANDATORY) if (!have.has(m) && RETRIEVAL_FUNCTIONS[m]) calls.push({ fn: m, params: {} });
  const selectReason = '(deterministic selection)';

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
  // 'deterministic' is the only build mode since 2026-08-31. Older persisted rows carry the
  // `broker-*` era modes ('broker-curated', 'broker-partial', 'broker-select') — kept as-is in
  // the DB; meta.mode on the ai_log rows says which era a row belongs to.
  const mode = 'deterministic';
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
    brokerSelect: null,
    brokerSummarize: null,
  });
  // Durable log: same kinds as the Broker era so the X-ray's history reads through the
  // 2026-08-31 changes; output.deterministic + meta.mode say which era a row belongs to.
  void logAi(userId, {
    kind: 'pack_select',
    input: { intent },
    output: { deterministic: true, fns: calls.map((c) => c.fn) },
    meta: { mode },
  });
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
