import type { WeekReviewDay, WeekReviewFacts, WeekReviewMeal } from '../../../lib/api.ts';

/**
 * Pure "apply this toggle to the facts I already have" math (check-in rebuild, step 5) — the
 * client-side twin of `week-review-write.ts`'s own read-merge-write rules, kept in sync by hand
 * since the two live in different workspaces. `useWeekReview` calls these to compute the
 * OPTIMISTIC next value before the write even reaches the server; nothing here talks to the
 * network or knows whether the write it's anticipating will actually land.
 *
 * Every function returns a new `WeekReviewFacts` rather than mutating — `useWeekReview` keeps the
 * previous value around to revert to if the paired write fails.
 */

function mapDays(facts: WeekReviewFacts, fn: (day: WeekReviewDay) => WeekReviewDay): WeekReviewFacts {
  return { ...facts, days: facts.days.map(fn) };
}

/** A session (or the week's weigh-in, via the same route) confirmed done/skipped, optionally
 *  with minutes — mirrors `confirmSession`'s own status rule: `done` maps to 'done', `!done` to
 *  'skipped', never back to 'pending' (that's what makes the toggle a real confirm, not a maybe). */
export function applySessionToggle(
  facts: WeekReviewFacts,
  occurrenceId: string,
  done: boolean,
  minutes?: number,
): WeekReviewFacts {
  return mapDays(facts, (day) => ({
    ...day,
    sessions: day.sessions.map((s) =>
      s.occurrence_id === occurrenceId
        ? { ...s, status: done ? 'done' : 'skipped', ...(minutes != null ? { logged_min: minutes } : {}) }
        : s,
    ),
  }));
}

/** A day's meal slot flipped logged/not — keyed by (date, meal), same as the server's own diff
 *  (a slot's occurrence_id can still be null client-side; the toggle only ever fires from a row
 *  the sheet already rendered, so a real slot is always there to flip). */
export function applyMealToggle(
  facts: WeekReviewFacts,
  date: string,
  meal: WeekReviewMeal,
  logged: boolean,
): WeekReviewFacts {
  return mapDays(facts, (day) =>
    day.date === date ? { ...day, meals: day.meals.map((m) => (m.meal === meal ? { ...m, logged } : m)) } : day,
  );
}

/** One named step of a mind/practice row's checklist — mirrors `toggleMindStep`'s own status
 *  rule: all steps done sets the row 'done'; un-flipping the step holding it there reverts it to
 *  'pending'; any other status (e.g. already 'skipped') is left alone. */
export function applyMindStepToggle(
  facts: WeekReviewFacts,
  occurrenceId: string,
  step: string,
  done: boolean,
): WeekReviewFacts {
  return mapDays(facts, (day) => ({
    ...day,
    mind: day.mind.map((row) => {
      if (row.occurrence_id !== occurrenceId || !row.steps) return row;
      const steps = row.steps.map((s) => (s.name === step ? { ...s, done } : s));
      const allDone = steps.every((s) => s.done);
      return { ...row, steps, status: allDone ? 'done' : row.status === 'done' ? 'pending' : row.status };
    }),
  }));
}

/** The week's weigh-in row, confirmed done/not — a plain status flip. Not part of any day, so it
 *  rides on `facts.weigh_in` directly rather than through `mapDays`. */
export function applyWeighInToggle(facts: WeekReviewFacts, done: boolean): WeekReviewFacts {
  if (!facts.weigh_in) return facts;
  return { ...facts, weigh_in: { ...facts.weigh_in, status: done ? 'done' : 'skipped' } };
}
