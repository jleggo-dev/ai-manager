/**
 * The wall (owner, 2026-09-07): "I'm okay showing an endless horizon, just as long as the
 * check-in is static and we can't really move past it without doing so explicitly."
 *
 * When the week has run out (`weekState.checkin_due`), the trail keeps drawing the days ahead —
 * but past the check-in they are LOCKED: dimmed, no tap, no hold. The two exits are the card's
 * own buttons ("Start check-in" / "Just build my week"); nothing on a locked day is one. This file
 * is the one place that decides which days those are, so TodayTrail's loop stays a two-line
 * change and the rule has a table test (`trailLock.test.ts`).
 *
 * The rule: lock every day AFTER the later of `ends_on` and today. `ends_on` is the due date
 * (plan-view.ts `computeWeekState`), so the week's last real day is the one before it and
 * `ends_on` itself renders normally; and today is never locked however late the check-in is —
 * the day the person is standing in stays theirs to log. A malformed or missing date fails OPEN
 * (nothing locked): a wall that cannot say where it stands must not brick the week.
 */
export interface TrailWeekState {
  ends_on: string;
  checkin_due: boolean;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** YYYY-MM-DD + 1, pure date arithmetic (no zone) — same idiom as the server's `addDays`. */
function nextDay(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + 1)).toISOString().slice(0, 10);
}

/**
 * The first locked day, or null when nothing is locked (no check-in due, or a date the rule
 * cannot read). `todayIso` is the trail's own today (`plan.week[0].date`); absent, `ends_on`
 * alone decides.
 */
export function lockedFromDate(
  weekState: TrailWeekState | null | undefined,
  todayIso: string | null | undefined,
): string | null {
  if (!weekState?.checkin_due) return null;
  if (!ISO_DATE.test(weekState.ends_on)) return null;
  const today = todayIso && ISO_DATE.test(todayIso) ? todayIso : null;
  const lastOpen = today && today > weekState.ends_on ? today : weekState.ends_on;
  return nextDay(lastOpen);
}

/** Is this day behind the wall? ISO date strings compare lexically, so no parsing is needed —
 *  and anything that is not one is never locked. */
export function isLockedDay(date: string, lockedFrom: string | null | undefined): boolean {
  if (!lockedFrom || !ISO_DATE.test(lockedFrom) || !ISO_DATE.test(date)) return false;
  return date >= lockedFrom;
}
