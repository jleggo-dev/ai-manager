import type { Plan } from '@cadence/shared';

/**
 * The week clock (0058, owner 2026-09-07: "I still have never been prompted for a weekly
 * check-in").
 *
 * The check-in used to be timed off the ACTIVE plan's `generated_at` — and every commit inserts a
 * new plan version with a fresh one: accepting a proposal, an Adjust, adding a routine, a replan,
 * the fan-out. So an engaged user, the one who touches their plan at all, had their week quietly
 * restarted with every touch and never reached `checkin_due`. DESIGN-check-in.md's "any commit IS
 * the week being handled" was the assumption that turned out wrong in practice.
 *
 * `week_started_at` is the clock that does NOT move on an ordinary commit. Every reader of "when
 * did this week begin" goes through `weekStartedAt` here — `computeWeekState` (the card),
 * `extendHorizon`, the weekly_checkin push (its SQL twin is `coalesce(week_started_at,
 * generated_at)` in notify-candidates.ts), the coach's date line, `open_week_review`'s window —
 * so none of them can drift back to `generated_at` on their own.
 */
export type WeekClockPlan = Pick<Plan, 'generated_at'> & Partial<Pick<Plan, 'week_started_at'>>;

/** When the plan's current week began. `generated_at` is the fallback for rows read before the
 *  column existed — exactly the behaviour the app had until 0058, so nothing regresses. Either
 *  may arrive as a `Date` rather than the string the type promises (a driver quirk plan-view.ts
 *  already guards), so callers wanting arithmetic use `weekStartMs`. */
export function weekStartedAt(plan: WeekClockPlan): string | Date {
  return plan.week_started_at ?? plan.generated_at;
}

export function weekStartMs(plan: WeekClockPlan): number {
  return new Date(weekStartedAt(plan)).getTime();
}

/** YYYY-MM-DD of the week's first day, for occurrence windows and the review card. */
export function weekStartIso(plan: WeekClockPlan): string {
  return new Date(weekStartedAt(plan)).toISOString().slice(0, 10);
}

/**
 * What a NEW plan version's `week_started_at` should be, decided from the version it supersedes.
 *
 *  - An ordinary commit carries the outgoing week's clock forward unchanged: the user is still
 *    in the same week, they just edited it.
 *  - `startsNewWeek` (the two check-in exits — "Just build my week", "Confirm my week") returns
 *    null, which `insertPlan` turns into `now()`: this commit IS the next week starting.
 *  - No predecessor (a first-ever plan) also returns null: its week starts at its own commit.
 */
export function carriedWeekStart(old: WeekClockPlan | null, startsNewWeek: boolean): string | null {
  if (startsNewWeek || !old) return null;
  return new Date(weekStartedAt(old)).toISOString();
}
