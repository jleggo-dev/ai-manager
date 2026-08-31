/**
 * The Progress Engine's DEFAULT composer (docs/cadence/PROGRESS-ENGINE.md "The layout model").
 *
 * `defaultLayout` is a pure function of the user's confirmed/committed goals — no DB calls in
 * here; callers (the route, or a future coach tool) fetch goals and pass them in. It derives an
 * ORDERED `ProgressLayout` the same way the coach's own composition tools will (Wave 3): fitness
 * shows FIRST by ORDER only, never by taxonomy — a mind/practice-only user gets a practice-led
 * page with no time-axis kind leading it, per the owner ruling "not everyone defines success
 * linearly/temporally."
 *
 * Classification mirrors the goal→card mapping services/progress.ts already uses (WEIGHTY_UNIT /
 * COUNTABLE_UNIT regexes) so a goal reads the same way on the dashboard and on this page. Those
 * consts are module-private over there and progress.ts is out of scope for this parcel, so they're
 * re-declared here rather than imported — see the parcel report for this as a follow-up worth a
 * shared home.
 */
import type { Goal, ProgressLayout, WidgetSpec } from '@cadence/shared';

const WEIGHTY_UNIT = /^(kg|kgs|lb|lbs|pound|pounds)$/i;
const COUNTABLE_UNIT = /book|session|class|workout|chapter|badge|race/i;

/**
 * Reserved for future composer inputs (e.g. a feature flag gating an in-progress widget kind, or
 * context the coach's composition tools need that a bare goal list doesn't carry). No field is
 * read today; kept in the signature so adding one later isn't a breaking change for callers.
 */
export type DefaultLayoutOptions = Record<string, unknown>;

const goalWidgetId = (g: Goal) => `w-goal-${g.goal_id}`;
const stageWidgetId = (g: Goal) => `w-goal-${g.goal_id}-stage`;

/**
 * The goal facts a card wears (chip family color, the "34 days out" tag) — read off the goal row
 * itself, the one writer for these fields. The composing model never sets them; see
 * `stampGoalFacts` for the coach-composed path.
 */
const goalFacts = (g: Goal): Pick<WidgetSpec, 'area' | 'deadline'> => ({
  ...(g.area ? { area: g.area } : {}),
  ...(g.timeframe?.end ? { deadline: g.timeframe.end } : {}),
});

/**
 * Stamp goal facts onto a composed layout's goal-linked sections (matched by `source.goal_id`).
 * Runs AFTER validation on the coach-composed path, deterministically overwriting anything the
 * model may have written into these fields — the model picks the sections, the goal rows supply
 * the facts.
 */
export function stampGoalFacts(layout: ProgressLayout, goals: Goal[]): ProgressLayout {
  const byId = new Map(goals.map((g) => [g.goal_id, g]));
  return {
    ...layout,
    sections: layout.sections.map((s) => {
      const g = s.source?.goal_id ? byId.get(s.source.goal_id) : undefined;
      return g ? { ...s, ...goalFacts(g) } : s;
    }),
  };
}

/* ── Goal classification (the composer's only "judgement calls") ─────────────────────────── */

const isRecurring = (g: Goal) => g.type === 'recurring';

/** "A weight-style measure (target + unit weight)" — same test progress.ts uses for the weight card. */
const isWeightGoal = (g: Goal) => typeof g.measure?.target === 'number' && WEIGHTY_UNIT.test(g.measure?.unit ?? '');

/** A fixed-target count ("books 21/100") — never a weight goal, whatever area it lives in. */
const isCountGoal = (g: Goal) =>
  g.type === 'target' &&
  typeof g.measure?.target === 'number' &&
  !isWeightGoal(g) &&
  COUNTABLE_UNIT.test(g.measure?.unit ?? '');

/** Movement, dated, individually-tracked — not the recurring schedule (that's rhythm) or a count/weight goal. */
const isMovementActivity = (g: Goal) => g.area === 'movement' && !isRecurring(g) && !isWeightGoal(g) && !isCountGoal(g);

/** A goal with coach-proposed stepping-stones, any area. */
const hasSteppingStones = (g: Goal) => g.type === 'milestone' && (g.milestones?.length ?? 0) > 0;

const isMindOrPractice = (g: Goal) => g.area === 'mind' || g.area === 'practice';

/** "Presence, not slope" — a mind/practice goal with a real numeric target that isn't a weight or count goal. */
const isMindPracticeTotal = (g: Goal) =>
  isMindOrPractice(g) && typeof g.measure?.target === 'number' && !isWeightGoal(g) && !isCountGoal(g);

const isMovementOrNourishment = (g: Goal) => g.area === 'movement' || g.area === 'nourishment';

/* ── Per-area derivation (kept small; each is one bullet from the design doc) ────────────────── */

function deriveRhythm(goals: Goal[]): WidgetSpec | null {
  return goals.some(isRecurring) ? { id: 'w-rhythm', kind: 'rhythm', title: 'Your rhythm' } : null;
}

function deriveWeightGoals(goals: Goal[]): WidgetSpec[] {
  return goals.filter(isWeightGoal).map((g) => ({
    id: goalWidgetId(g),
    kind: 'trend_vs_target' as const,
    title: g.title,
    source: { measure: 'weight' },
    ...goalFacts(g),
  }));
}

function deriveMovementActivities(goals: Goal[]): WidgetSpec[] {
  return goals.filter(isMovementActivity).map((g) => ({
    id: goalWidgetId(g),
    kind: 'dated_sessions' as const,
    title: g.title,
    source: { activity: g.title },
    ...goalFacts(g),
  }));
}

function deriveMovementEngagement(goals: Goal[]): WidgetSpec | null {
  return goals.some((g) => g.area === 'movement')
    ? { id: 'w-steps', kind: 'weekly_bars', title: 'Your steps', source: { measure: 'steps' } }
    : null;
}

function deriveNourishmentEngagement(goals: Goal[]): WidgetSpec[] {
  if (!goals.some((g) => g.area === 'nourishment')) return [];
  return [
    { id: 'w-kcal', kind: 'weekly_bars', title: 'Your kcal', source: { measure: 'kcal' } },
    { id: 'w-variety', kind: 'variety', title: 'Your variety' },
  ];
}

function deriveCountToward(goals: Goal[]): WidgetSpec[] {
  return goals.filter(isCountGoal).map((g) => ({
    id: goalWidgetId(g),
    kind: 'count_toward' as const,
    title: g.title,
    source: { goal_id: g.goal_id },
    ...goalFacts(g),
  }));
}

function deriveStagePath(goals: Goal[]): WidgetSpec[] {
  return goals.filter(hasSteppingStones).map((g) => ({
    id: stageWidgetId(g),
    kind: 'stage_path' as const,
    title: g.title,
    source: { goal_id: g.goal_id },
    ...goalFacts(g),
  }));
}

function deriveBalance(goals: Goal[]): WidgetSpec | null {
  return goals.some(isMindOrPractice)
    ? { id: 'w-balance', kind: 'balance', title: 'Your practice', source: { feedback_kind: 'mind' } }
    : null;
}

function deriveTotals(goals: Goal[]): WidgetSpec[] {
  return goals.filter(isMindPracticeTotal).map((g) => ({
    id: goalWidgetId(g),
    kind: 'total' as const,
    title: g.title,
    source: { goal_id: g.goal_id },
    ...goalFacts(g),
  }));
}

function deriveShelf(goals: Goal[]): WidgetSpec | null {
  return goals.length ? { id: 'w-shelf', kind: 'shelf', title: 'Your bests' } : null;
}

const RECAP_RAIL: WidgetSpec = { id: 'w-recap', kind: 'recap_rail', title: 'Your weekly check-in' };
const HISTORY: WidgetSpec = { id: 'w-history', kind: 'history', title: 'Your history' };

/* ── Assembly ──────────────────────────────────────────────────────────────────────────────── */

/**
 * The deterministic default composition. `recap_rail` and `history` are ALWAYS last, in that
 * order, whichever path a user takes.
 *
 * Fitness-first path (any movement or nourishment goal exists): rhythm → weight →
 * movement activities → steps → nourishment (kcal + variety) → count/stage-path →
 * balance/total → shelf.
 *
 * Practice-led path (no movement/nourishment goals — mind/practice only, or no goals at all):
 * shelf → balance → total → count/stage-path, with NO time-axis kind above that block; rhythm
 * still appears, but only AFTER it, and only if a recurring goal exists.
 */
export function defaultLayout(goals: Goal[], _opts: DefaultLayoutOptions = {}): ProgressLayout {
  const fitnessLed = goals.some(isMovementOrNourishment);

  const rhythm = deriveRhythm(goals);
  const balance = deriveBalance(goals);
  const shelf = deriveShelf(goals);
  const countWidgets = deriveCountToward(goals);
  const stageWidgets = deriveStagePath(goals);
  const totals = deriveTotals(goals);
  const steps = deriveMovementEngagement(goals);

  const sections: WidgetSpec[] = fitnessLed
    ? [
        ...(rhythm ? [rhythm] : []),
        ...deriveWeightGoals(goals),
        ...deriveMovementActivities(goals),
        ...(steps ? [steps] : []),
        ...deriveNourishmentEngagement(goals),
        ...countWidgets,
        ...stageWidgets,
        ...(balance ? [balance] : []),
        ...totals,
        ...(shelf ? [shelf] : []),
      ]
    : [
        ...(shelf ? [shelf] : []),
        ...(balance ? [balance] : []),
        ...totals,
        ...countWidgets,
        ...stageWidgets,
        ...(rhythm ? [rhythm] : []),
      ];

  sections.push(RECAP_RAIL, HISTORY);

  return { version: 1, status: 'default', sections };
}
