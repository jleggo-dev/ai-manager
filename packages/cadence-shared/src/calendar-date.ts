/**
 * The one check for "is this a YYYY-MM-DD day" (CLAUDE.md: a regex that decides behaviour lives in
 * `@cadence/shared` once). The shape alone, `/^\d{4}-\d{2}-\d{2}$/`, let "2026-02-30" through; the
 * `::date` cast in Postgres then threw and the caller saw a 500 where a 400 or a plain refusal was
 * the answer. The table test is calendar-date.test.ts.
 *
 * Plain arithmetic, not `Date.parse`: engines differ on what they roll over or accept, and year
 * 0000 is refused on purpose because Postgres has no year zero.
 */

const DAY_SHAPE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

/** True only for a string written YYYY-MM-DD that names a day that exists (leap years included). */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const m = DAY_SHAPE.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const last = month === 2 && isLeapYear(year) ? 29 : (DAYS_IN_MONTH[month - 1] ?? 0);
  return day <= last;
}
