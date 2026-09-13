/**
 * When the week wraps, as a person would say it — the horizon end-cap's one sentence, in its own
 * file for the same reason `detour-bar-line.ts` is: a pure string the tests can hold without
 * mounting the component (and react-refresh wants component files exporting only components).
 */
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Local calendar day — the phrase's clock is the user's day, not UTC (PlanView's own rule).
 *  Shared by the end-cap and the end-of-trail card so the two can never name different days. */
export function localTodayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * `endsOn` is `weekState.ends_on` (the DUE date — the day `checkin_due` flips, see the API's
 * plan-view.ts). Within a week a bare weekday is unambiguous; further out (an extended week) the
 * date rides along so "Saturday" can't mean two Saturdays. Null for anything unparseable — the
 * caller renders nothing rather than a wrong sentence.
 */
export function endPhrase(endsOn: string | undefined, todayIso: string): string | null {
  if (!endsOn) return null;
  const end = Date.parse(`${endsOn}T00:00:00Z`);
  const today = Date.parse(`${todayIso}T00:00:00Z`);
  if (Number.isNaN(end) || Number.isNaN(today)) return null;
  const days = Math.round((end - today) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'tomorrow';
  const d = new Date(end);
  if (days < 7) return `on ${WEEKDAYS[d.getUTCDay()]}`;
  return `on ${WEEKDAYS[d.getUTCDay()]}, ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}
