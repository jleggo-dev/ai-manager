import type { Plan } from '@cadence/shared';
import { localDayIso } from './plan-day.ts';

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

/**
 * YYYY-MM-DD of the week's first day, for occurrence windows and the review card — in the USER's
 * zone when one is given (plan-day.ts's precedence: stored zone, else UTC). The clock is an
 * instant; the day it names is a local fact. A week confirmed at 20:52 in Montréal began on that
 * evening's date, not on the UTC date it had already become — and `computeWeekState` counts
 * `ends_on` from this day, so the check-in lands where the trail (which lives in local dates)
 * expects it. No zone → the UTC date, exactly the behaviour every caller had before.
 */
export function weekStartIso(plan: WeekClockPlan, timezone?: string | null): string {
  return localDayIso(new Date(weekStartedAt(plan)), timezone);
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

/** A plan row's `built_through` (0059) as YYYY-MM-DD, or null. The driver hands a `date` column
 *  back as a Date, so every reader normalizes here rather than comparing a Date to a string. */
export function builtThroughIso(plan: Pick<Plan, 'built_through'> | null | undefined): string | null {
  const raw = plan?.built_through;
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * What a NEW plan version's `built_through` should be (0059), by the same logic as the clock: an
 * ordinary commit keeps the decision the user made ("build next week" still stands after an
 * Adjust); a commit that STARTS a week is the next week arriving, so nothing is built past its
 * own check-in yet; a first-ever plan has nothing to carry.
 */
export function carriedBuiltThrough(old: Pick<Plan, 'built_through'> | null, startsNewWeek: boolean): string | null {
  if (startsNewWeek || !old) return null;
  return builtThroughIso(old);
}
