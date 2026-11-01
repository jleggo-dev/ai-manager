/**
 * What note_follow_up and close_follow_up accept, decided in one place (HARNESS-V3 P7b).
 *
 * Both are routers in the CLAUDE.md sense: a regex here decides whether her call reaches the table,
 * and a wrong answer fails quietly — "nothing matched", or a generic fault from a cast deep in SQL.
 * So each has a table test of positives and near-misses (follow-up-input.test.ts).
 */

/** A run of the characters a uuid is written in. */
const UUID_RUN = /[0-9a-f-]+/g;
/** How many characters of the id her context shows — and the fewest a match may use. */
const MIN_ID_CHARS = 8;

/**
 * The id she passed, as the repo matches it — or null when there is no single id in it.
 *
 * Her context prints each id in brackets and tells her to close by "its id in brackets", so
 * `[3f9a2c1d]` is the most natural thing for her to send back; before this it matched nothing.
 * Rather than strip every non-hex character (which would glue the `d` of "id: 3f9a2c1d" onto the
 * front), this takes the runs of uuid characters in what she sent and keeps the ONE that is long
 * enough to be an id. Two such runs is two ids, and closes neither.
 */
export function normalizeFollowUpId(raw: string): string | null {
  const runs = (raw.toLowerCase().match(UUID_RUN) ?? [])
    .map((r) => r.replace(/^-+|-+$/g, ''))
    .filter((r) => r.replace(/-/g, '').length >= MIN_ID_CHARS);
  return runs.length === 1 ? runs[0]! : null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * True for a YYYY-MM-DD that is a real day. The shape alone let "2026-02-30" through, and the
 * `::date` cast then threw inside the insert and reached her as a generic fault instead of a reason
 * she could fix. Round-tripping through Date catches every impossible day (JS rolls Feb 30 over to
 * Mar 2, so the string no longer matches); year 0000 is refused because Postgres has no year zero.
 */
export function isCalendarDate(s: string): boolean {
  if (!ISO_DATE.test(s) || s.startsWith('0000')) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
