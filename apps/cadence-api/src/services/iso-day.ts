/**
 * "YYYY-MM-DD" from whatever the database actually handed us.
 *
 * `postgres.js` returns `timestamptz` as a JavaScript **Date**, but our row types are
 * hand-written generics on the query — so a column declared `started_at: string` type-checks
 * everywhere while being a Date at runtime, and TypeScript never says a word. Every
 * `value.slice(0, 10)` written against one of those columns is a crash waiting for real data.
 *
 * It was not waiting long. On 2026-08-16 both of the coach's Apple Health reads —
 * `get_workout_history` and `get_health_history` — threw here for a user with a full workout log,
 * and the tool path turned the throw into "(nothing on file for this yet)". So she asked for the
 * user's runs, was told there weren't any, and said so. That is the owner's "Coach wasn't able to
 * actually read from healthkit", one layer below where we went looking for it.
 *
 * Accepts what the callers really see, returns '' for anything unusable — a date line is never
 * worth taking a whole tool down for.
 */
export function isoDay(value: string | Date | null | undefined): string {
  if (!value) return '';
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? '' : value.toISOString().slice(0, 10);
  if (typeof value !== 'string') return '';
  // Already an ISO-ish string: take the day off the front rather than re-parsing (a bare
  // "2026-08-16" parses as UTC midnight, which can roll backwards a day in a western timezone).
  if (/^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}
