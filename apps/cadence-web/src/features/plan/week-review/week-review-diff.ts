/**
 * The client-side twin of `apps/cadence-api/src/services/week-review-diff.ts` — the same counting
 * semantics, ported rather than shared (the web app never imports server internals; see
 * `lib/api/plan.ts`'s own `WeekReviewFacts`, which mirrors `week-review-facts.ts`'s shape the same
 * way). Kept in sync by hand: a change to the server's counting rule belongs here too.
 *
 * PURE — no fetch, no clock. `before` is the facts as first fetched (`useWeekReview`'s
 * `initialFacts`); `after` is the same shape with the session's toggles applied. This is what
 * "Confirm my week" reads to compute N and the receipt's tallies — see `confirm-copy.ts`.
 */
import type { WeekReviewFacts, WeekReviewMealSlot, WeekReviewMindRow, WeekReviewSessionRow } from '../../../lib/api.ts';

export interface WeekReviewCorrectionsSummary {
  sessions_done: number;
  sessions_total: number;
  meals_logged: number;
  meals_total: number;
  corrections: number;
}

export interface WeekReviewDiffResult {
  corrections: number;
  summary: WeekReviewCorrectionsSummary;
}

const allSessions = (facts: WeekReviewFacts): WeekReviewSessionRow[] => facts.days.flatMap((d) => d.sessions);
const allMeals = (facts: WeekReviewFacts): WeekReviewMealSlot[] => facts.days.flatMap((d) => d.meals);
const allMind = (facts: WeekReviewFacts): WeekReviewMindRow[] => facts.days.flatMap((d) => d.mind);

/** A session counts as changed once for a status flip, once more for a minutes change. */
function countSessionCorrections(before: Map<string, WeekReviewSessionRow>, after: WeekReviewSessionRow[]): number {
  let corrections = 0;
  for (const a of after) {
    const b = before.get(a.occurrence_id);
    if (!b) continue;
    if (b.status !== a.status) corrections += 1;
    if ((b.logged_min ?? null) !== (a.logged_min ?? null)) corrections += 1;
  }
  return corrections;
}

function countMealCorrections(before: Map<string, WeekReviewMealSlot>, after: Map<string, WeekReviewMealSlot>): number {
  let corrections = 0;
  for (const [key, a] of after) {
    const b = before.get(key);
    if (b && b.logged !== a.logged) corrections += 1;
  }
  return corrections;
}

/** A mind row with named steps counts one correction PER STEP that flipped; a row with no steps
 *  counts one correction if its plain `done` flipped. */
function countMindCorrections(before: Map<string, WeekReviewMindRow>, after: WeekReviewMindRow[]): number {
  let corrections = 0;
  for (const a of after) {
    const b = before.get(a.occurrence_id);
    if (!b) continue;
    if (a.steps) {
      const beforeDoneByName = new Map((b.steps ?? []).map((s) => [s.name, s.done]));
      for (const step of a.steps) {
        const prevDone = beforeDoneByName.get(step.name);
        if (prevDone !== undefined && prevDone !== step.done) corrections += 1;
      }
    } else if (typeof a.done === 'boolean' && typeof b.done === 'boolean' && a.done !== b.done) {
      corrections += 1;
    }
  }
  return corrections;
}

/** Meal slots are keyed by (date, meal), not occurrence_id — a slot's id can go from null to set
 *  the first time it's toggled, so id-keying would silently miss exactly the edit that matters. */
function mealKey(date: string, meal: string): string {
  return `${date}:${meal}`;
}

/**
 * Count what changed between the two grids, and the final tallies the receipt reads out.
 * `corrections` counts each genuinely changed value exactly once — never the same change twice,
 * never a row just for existing. The weigh-in row deliberately does not participate: toggling it
 * is status only (see `applyWeighInToggle`), the same way the server's own diff never reads
 * `weigh_in` either.
 */
export function diffWeekReview(before: WeekReviewFacts, after: WeekReviewFacts): WeekReviewDiffResult {
  const beforeSessions = new Map(allSessions(before).map((s) => [s.occurrence_id, s]));
  const beforeMeals = new Map(before.days.flatMap((d) => d.meals.map((m) => [mealKey(d.date, m.meal), m] as const)));
  const afterMeals = new Map(after.days.flatMap((d) => d.meals.map((m) => [mealKey(d.date, m.meal), m] as const)));
  const beforeMind = new Map(allMind(before).map((r) => [r.occurrence_id, r]));

  const corrections =
    countSessionCorrections(beforeSessions, allSessions(after)) +
    countMealCorrections(beforeMeals, afterMeals) +
    countMindCorrections(beforeMind, allMind(after));

  const afterSessions = allSessions(after);
  const afterMealsFlat = allMeals(after);

  return {
    corrections,
    summary: {
      sessions_done: afterSessions.filter((s) => s.status === 'done').length,
      sessions_total: afterSessions.length,
      meals_logged: afterMealsFlat.filter((m) => m.logged).length,
      meals_total: afterMealsFlat.length,
      corrections,
    },
  };
}
