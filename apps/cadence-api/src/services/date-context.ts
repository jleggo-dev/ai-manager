/**
 * Keeps the Coach's live chat session grounded in the current date/time (+ weather when we
 * know where the user is). The persona (system prompt) has to stay static/cacheable, and the
 * session-open context pack is built once and then reused indefinitely (a returning user's
 * session is restored, not reopened — see GET /coach/current) — so without this, the coach's
 * only notion of "today" is whatever day the session happened to first open, forever. Stamped
 * once per calendar day per session (a cheap in-memory check) rather than every turn.
 *
 * Keyed by SESSION, not user: a user who was already stamped today can still end up in a
 * brand-new session (dev reset, or any future new-session path) whose history has no date
 * turn yet — keying by user alone would wrongly skip it. sessionId is globally unique, so
 * this always stamps a session's first turn and then re-stamps only when the day rolls over.
 *
 * Weather is deterministic API data (§B1) — never invented by the LLM.
 */
import { injectCoachContext } from '../ai/aim.ts';
import { getUser } from '../repos/users.ts';
import { getActivePlan } from '../repos/plans.ts';
import { listOccurrences } from '../repos/occurrences.ts';
import { computeWeekState } from './plan-view.ts';
import { formatWeatherLine, getWeatherForUser, localDateIso, localTimeLabel } from './weather/weather.ts';

const lastStamped = new Map<string, string>();

/** Date-only slice, the same defensive cast plan-view.ts's own `iso()` uses: a driver can hand
 *  `generated_at` back as a `Date` rather than the string the type promises. */
const toIsoDate = (d: string | Date): string => new Date(d).toISOString().slice(0, 10);

/**
 * "Their plan week ended N days ago" — `computeWeekState` (plan-view.ts) already reports this to
 * the app as a card (`weekState.checkin_due`) and to the push producer (`checkin-due.ts`), but
 * never to the coach herself. A late-or-empty week goes stale for exactly the reason this file
 * already exists to fix: a session opened while the week was still running is RESTORED, not
 * reopened, once it ends, so without a fresh stamp she never learns it did. It rides the same
 * daily stamp as the date line, for the same reason.
 *
 * Silent (empty string) when there is no active plan, or the week isn't due yet — a plan still
 * mid-week is already fully described by `get_active_plan` and needs no extra note.
 *
 * `n` is included so she can privately tell "just due" from properly late (coach-picks-protocol.ts
 * draws that line at 7 days) — the protocol forbids her ever SAYING a day count, so this line is
 * for her reasoning only, never for her mouth.
 */
async function checkinStateLine(userId: string): Promise<string> {
  const plan = await getActivePlan(userId).catch(() => null);
  if (!plan) return '';
  const state = computeWeekState(plan);
  if (!state?.checkin_due) return '';

  const daysLate = Math.floor((Date.now() - Date.parse(`${state.ends_on}T00:00:00Z`)) / 86_400_000);
  const when = daysLate <= 0 ? 'ended today' : `ended ${daysLate} day${daysLate === 1 ? '' : 's'} ago`;
  const parts = [`Their plan week ${when}; check-in not yet done.`];

  // Same window the review card itself would show (generated_at through the due date) — "empty"
  // means there is nothing on the card to look at, not merely that nobody has looked yet.
  const occ = await listOccurrences(userId, toIsoDate(plan.generated_at), state.ends_on).catch(() => []);
  if (!occ.some((o) => o.status === 'done')) parts.push('Last week has no logged activity.');

  return parts.join(' ');
}

/** Best-effort: inject a fresh date/time (+ weather) stamp if today hasn't been stamped yet. */
export async function ensureDateStamped(userId: string, sessionId: string): Promise<void> {
  const user = await getUser(userId).catch(() => null);
  const tz = user?.timezone ?? null;
  const now = new Date();
  const iso = localDateIso(now, tz);
  if (lastStamped.get(sessionId) === iso) return;
  lastStamped.set(sessionId, iso);

  const localLabel = localTimeLabel(now, tz);
  const tzNote = tz ? ` (timezone ${tz})` : '';
  const parts = [`Local date/time: ${localLabel}${tzNote}.`, `Calendar day: ${iso}.`];

  const weather = await getWeatherForUser(userId).catch(() => null);
  if (weather) {
    parts.push(`Current weather near home: ${formatWeatherLine(weather)}.`);
  } else if (user?.home_location) {
    parts.push('Weather unavailable right now — do not invent conditions.');
  } else {
    parts.push('Home location not set yet — ask once, warmly, if outdoor plans come up.');
  }

  const checkin = await checkinStateLine(userId).catch(() => '');
  if (checkin) parts.push(checkin);

  await injectCoachContext(userId, sessionId, parts.join(' '), { source: 'date', version: 3 }).catch((e) =>
    console.error('[date-context]', e),
  );
}

/** Test seam — clear per-session stamp memory. */
export function __clearDateStampForTests(): void {
  lastStamped.clear();
}
