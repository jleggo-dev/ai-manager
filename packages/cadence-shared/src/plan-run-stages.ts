/**
 * The stages a background plan synthesis moves through, in the order they happen.
 *
 * ONE list, because both ends read it: the API stamps a stage into `cadence.users.plan_run`
 * (repos/users.ts) and the client renders it. The web side used to hand-copy this union, which is
 * the shape that let FOOD_SOURCES go stale and kill quick-add for weeks — with the list derived
 * from here instead, a stage added on the server cannot silently mean nothing to the client.
 *
 * Order is load-bearing: `planRunProgressFloor` reads the INDEX to decide how far along a run is,
 * so a stage inserted in the middle moves every stage after it. Append in the right position,
 * never reorder.
 */
export const PLAN_RUN_STAGES = ['reading', 'drafting', 'coordinating', 'repairing', 'saving'] as const;

export type PlanRunStage = (typeof PLAN_RUN_STAGES)[number];

/**
 * `repairing` is CONDITIONAL — it fires only when the coordinated week comes back too thin
 * (plan-density.ts). A dense week goes straight from `coordinating` to `saving`, so nothing may
 * assume every run visits every stage, and a progress bar must never treat a skipped stage as
 * time still owed.
 */
export const CONDITIONAL_PLAN_RUN_STAGES: readonly PlanRunStage[] = ['repairing'];

/**
 * The share of a run considered COMPLETE once a stage has been entered — the floor a progress bar
 * may advance to on evidence, as opposed to on a timer.
 *
 * Deliberately not derived from measured durations. Every completed synthesis this app has
 * recorded (n=14 drafts, n=4 reduces, 2026-08-22 → 2026-09-05) spans 79s to 563s for the same
 * phase — a sevenfold spread — so a bar driven by an expected duration is wrong for most runs in
 * one direction or the other, and a bar that reaches 100% before the plan exists is the specific
 * lie this is meant to avoid. These are the only points a bar may claim as FACT; between them it
 * should ease toward the next floor without arriving, and only a committed plan completes it.
 */
export const PLAN_RUN_STAGE_FLOOR: Record<PlanRunStage, number> = {
  reading: 0.05,
  drafting: 0.2,
  coordinating: 0.55,
  repairing: 0.75,
  saving: 0.9,
};

/** The floor for a stage, or 0 for a run that has not reported one yet. */
export function planRunProgressFloor(stage: PlanRunStage | undefined): number {
  return stage ? PLAN_RUN_STAGE_FLOOR[stage] : 0;
}

/**
 * How fast the bar eases across a stage with nothing to count, in ms. Not a prediction — the
 * measured spread makes prediction impossible — just the rate at which movement decays. At one
 * tau the bar has covered ~63% of the gap to the next floor, at two ~86%, and it never arrives.
 */
const EASE_TAU_MS = 75_000;

/**
 * Where the bar should sit: a fraction in [0, 1).
 *
 * NEVER returns 1. Only a plan that actually exists finishes the bar, because the one thing a
 * progress display must not do here is claim completion before there is anything to show — that
 * is the specific lie that makes the next wait untrustworthy.
 *
 * Two regimes. `drafting` has real sub-events (one per goal, resolving on their own clocks), so
 * it advances on FACT: each landed draft moves the bar a real fraction of the way to the next
 * floor. Every other stage has one opaque model call inside it and nothing to count, so it eases
 * — always moving, never arriving, decelerating in a way that reads as "still working" rather
 * than "nearly done" after ninety seconds have passed with no news.
 */
export function planRunProgress(
  stage: PlanRunStage | undefined,
  drafted: { done: number; total: number } | undefined,
  msInStage: number,
): number {
  if (!stage) return 0;
  const floor = PLAN_RUN_STAGE_FLOOR[stage];
  // The last stage has no next floor to climb toward, so it eases against the gap to 1 instead.
  const next = PLAN_RUN_STAGES[PLAN_RUN_STAGES.indexOf(stage) + 1];
  const ceil = next ? PLAN_RUN_STAGE_FLOOR[next] : 1;
  const span = ceil - floor;

  if (stage === 'drafting' && drafted && drafted.total > 0) {
    // Fact first, then ease within whatever fraction of a goal is still in flight — so the bar
    // keeps moving between drafts landing, without ever overtaking the next real checkpoint.
    const perGoal = span / drafted.total;
    const landed = floor + perGoal * Math.min(drafted.done, drafted.total);
    return Math.min(landed + perGoal * ease(msInStage), ceil - 0.001);
  }
  return Math.min(floor + span * ease(msInStage), ceil - 0.001);
}

/** Asymptotic approach: 0 at rest, climbing toward but never reaching 1. */
function ease(ms: number): number {
  return 1 - Math.exp(-Math.max(0, ms) / EASE_TAU_MS);
}
