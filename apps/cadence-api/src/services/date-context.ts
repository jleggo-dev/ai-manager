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
import { formatWeatherLine, getWeatherForUser, localDateIso, localTimeLabel } from './weather/weather.ts';

const lastStamped = new Map<string, string>();

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

  await injectCoachContext(userId, sessionId, parts.join(' '), { source: 'date', version: 2 }).catch((e) =>
    console.error('[date-context]', e),
  );
}

/** Test seam — clear per-session stamp memory. */
export function __clearDateStampForTests(): void {
  lastStamped.clear();
}
