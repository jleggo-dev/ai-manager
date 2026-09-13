/**
 * The wall (owner, 2026-09-07): "I'm okay showing an endless horizon, just as long as the
 * check-in is static and we can't really move past it without doing so explicitly."
 *
 * The trail keeps drawing the days ahead — but past the check-in they are LOCKED: dimmed, their
 * discs there to see and to tap (a tap opens the gate prompt, PlanView's business), nothing to
 * hold. This file is the one place that decides which days those are, so TodayTrail's loop stays
 * a two-line change and the rule has a table test (`trailLock.test.ts`).
 *
 * Two dates, refined 2026-09-09:
 *  - `wallDate` — where the check-in CARD stands: the day after the later of `ends_on` and today.
 *    `ends_on` is the due date (plan-view.ts `computeWeekState`), so the week's last real day is
 *    the one before it and `ends_on` itself renders normally; and today is never behind the card
 *    however late the check-in is — the day the person is standing in stays theirs to log.
 *  - `lockedFromDate` — where the LOCK starts: the wall, pushed out past anything the user
 *    deliberately built ("Build next week", `built_through`). A built week is open; the check-in
 *    still lands on its own day and still asks.
 *
 * Neither needs `checkin_due`: a week materializes once, so from its second day the seven-day
 * view runs past what was written, and those days are the wall's from the start (they used to
 * render as blank ordinary days). A malformed or missing date fails OPEN (nothing locked): a wall
 * that cannot say where it stands must not brick the week.
 */
export interface TrailWeekState {
  ends_on: string;
  checkin_due: boolean;
  built_through?: string | null;
}

/** The one quiet line on a locked day — why its discs are muted (owner's wording, 2026-09-09). */
export const LOCKED_DAY_LINE = 'Locked until weekly check-in';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** YYYY-MM-DD + 1, pure date arithmetic (no zone) — same idiom as the server's `addDays`. */
function nextDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + 1)).toISOString().slice(0, 10);
}

/** Where the check-in card stands, or null when the dates cannot say. `todayIso` is the trail's
 *  own today (`plan.week[0].date`); absent, `ends_on` alone decides. */
export function wallDate(
  weekState: TrailWeekState | null | undefined,
  todayIso: string | null | undefined,
): string | null {
  if (!weekState || !ISO_DATE.test(weekState.ends_on)) return null;
  const today = todayIso && ISO_DATE.test(todayIso) ? todayIso : null;
  const lastOpen = today && today > weekState.ends_on ? today : weekState.ends_on;
  return nextDay(lastOpen);
}

/** The first locked day, or null when nothing is locked. Whether any day IN VIEW is actually
 *  behind it is the caller's question (`isLockedDay` over the week). */
export function lockedFromDate(
  weekState: TrailWeekState | null | undefined,
  todayIso: string | null | undefined,
): string | null {
  const wall = wallDate(weekState, todayIso);
  if (!wall) return null;
  const built = weekState?.built_through;
  if (built && ISO_DATE.test(built)) {
    const afterBuilt = nextDay(built);
    return afterBuilt > wall ? afterBuilt : wall;
  }
  return wall;
}

/** Is this day behind the wall? ISO date strings compare lexically, so no parsing is needed —
 *  and anything that is not one is never locked. */
export function isLockedDay(date: string, lockedFrom: string | null | undefined): boolean {
  if (!lockedFrom || !ISO_DATE.test(lockedFrom) || !ISO_DATE.test(date)) return false;
  return date >= lockedFrom;
}
