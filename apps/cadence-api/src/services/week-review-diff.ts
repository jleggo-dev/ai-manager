/**
 * The receipt's arithmetic: "5 of 5 sessions · 18 of 21 meals · 3 corrections" (DESIGN-check-in.md).
 *
 * PURE — no repo calls, no clock, nothing but the two grids. `before` is what `buildWeekReviewFacts`
 * returned when the review opened; `after` is the same shape once the user's toggles have been
 * applied (whether that's a locally-edited copy or a fresh re-read post-write is the caller's
 * choice — this function only compares the two). Kept pure on purpose: the corrections count is
 * what a card claims got confirmed, and DESIGN-check-in.md's own risk section ("assert the card,
 * not the prose") is exactly the failure mode a function nobody can unit-test invites.
 */
import type {
  WeekReviewFacts,
  WeekReviewMealSlot,
  WeekReviewMindRow,
  WeekReviewSessionRow,
} from './week-review-facts.ts';

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

/** Every session row across the week, in day order — the flattening both the diff and the tallies
 *  below share. */
const allSessions = (facts: WeekReviewFacts): WeekReviewSessionRow[] => facts.days.flatMap((d) => d.sessions);
const allMeals = (facts: WeekReviewFacts): WeekReviewMealSlot[] => facts.days.flatMap((d) => d.meals);
const allMind = (facts: WeekReviewFacts): WeekReviewMindRow[] => facts.days.flatMap((d) => d.mind);

/** A session counts as changed once for a status flip, once more for a minutes change — two
 *  genuinely different facts about the same row, so a row that got both counts as 2 corrections. */
function countSessionCorrections(before: Map<string, WeekReviewSessionRow>, after: WeekReviewSessionRow[]): number {
  let corrections = 0;
  for (const a of after) {
    const b = before.get(a.occurrence_id);
    if (!b) continue; // nothing to compare against — not a correction, just a row the before-grid lacked
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

/** A mind row with named steps counts one correction PER STEP that flipped (each is its own
 *  genuinely changed value); a row with no steps counts one correction if its plain `done` flipped. */
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

/** Meal slots are keyed by (date, meal) rather than occurrence_id: a slot's id can go from null to
 *  set the first time it's toggled, so id-keying would silently miss exactly the edit that matters. */
function mealKey(date: string, meal: string): string {
  return `${date}:${meal}`;
}

/**
 * Count what changed between the two grids, and the final tallies the receipt reads out.
 * `corrections` counts each genuinely changed value exactly once — a status flip, a minutes edit, a
 * meal flip, a mind-step flip — never the same change twice and never a row just for existing.
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
