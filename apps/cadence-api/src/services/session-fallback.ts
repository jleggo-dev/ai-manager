/**
 * The plain version of a session, built without the coach, for the moment she cannot be reached.
 *
 * Owner, 2026-10-28: a session's first open "shouldn't even NEED an LLM" when the coach is down.
 * After the bounded retries in session-generate-retry.ts have failed, this builds something the
 * person can actually do from what is already on file — deterministic code, no model:
 *
 *   1. What they last did under this title, carried forward. With a progression scheme on the
 *      activity (a deterministic-mode goal) the numbers move the way computeSession moves them;
 *      without one, the last session comes back as it was.
 *   2. Failing that, one plain block from the activity's own shape — a sit for a mind session, a
 *      page for a journal, reps for a rep target, a timer for a length.
 *   3. Nothing, when the activity carries no shape at all — the sheet then says the coach could not
 *      be reached and offers Try again.
 *
 * Marked `fallback: 'coach_unreachable'` and NEVER cached: the regenerate-on-next-open behaviour
 * is what lets her refine it the next time, and the marker is how the sheet tells the truth.
 */
import type { OccurrenceSession, SessionItem } from '@cadence/shared';
import { listRecentLogsByTitle, type OccurrenceWithActivity } from '../repos/occurrences.ts';
import { getLatestSessionByTitle } from '../repos/occurrence-sessions.ts';
import { computeSession, weekIndexBetween } from './progression.ts';

/** The note on a plain version — the app speaking about the coach, since she is the one missing. */
export const FALLBACK_NOTE =
  "The coach couldn't be reached just now, so this is a plain version of today's session. She'll refine it next time.";

type Prior = { date: string; session: OccurrenceSession } | null;

/** Carry the last session of this title forward — progressed when the activity has a scheme. */
function fromPrior(
  occ: OccurrenceWithActivity,
  prior: Prior,
  lastMissed: boolean,
  now: string,
): OccurrenceSession | null {
  if (!prior?.session?.blocks?.length) return null;
  const scheme = occ.target?.scheme;
  const carried = scheme
    ? computeSession(prior.session, scheme, { weekIndex: weekIndexBetween(prior.date, occ.date), lastMissed }, now)
    : { ...prior.session, generated_at: now, version: (prior.session.version ?? 0) + 1 };
  // Her old note described a different day; the plain version says what it is.
  return { ...carried, note: FALLBACK_NOTE, fallback: 'coach_unreachable' };
}

// "sit" on its own is not here: "Sit-ups" is strength work (the table test's near-miss).
const MIND = /\b(mind|mental|meditat\w*|breath\w*|calm|stillness|sitting)\b/i;
const JOURNAL = /\b(journal|reflect|gratitude|write|writing|morning pages)\b/i;

/**
 * One block from the activity's own shape. Each rule is a positive the table test pins, with a
 * near-miss beside it: a rep target is reps even for a "mind" category, a title with no length
 * and no target is nothing at all.
 */
export function plainItemFor(
  occ: Pick<OccurrenceWithActivity, 'title' | 'category' | 'schedule' | 'target'>,
): SessionItem | null {
  const minutes = occ.schedule?.duration_min;
  const target = occ.target ?? null;
  const metric = target?.metric?.toLowerCase() ?? '';
  const value = typeof target?.value === 'number' && target.value > 0 ? target.value : undefined;
  const text = `${occ.category ?? ''} ${occ.title}`;

  if (value && /\brep/.test(metric)) return { name: occ.title, tool: 'reps', sets: 1, reps: Math.round(value) };
  // No word boundaries anywhere here: metrics are snake_case ("distance_km", "distance_mi"), and
  // "_" is a word character, so \bmi\b would never match the mile one.
  if (value && /(km|kilomet|mile|distance|(?:^|_)mi(?:$|_))/.test(metric)) {
    const km = /mile|(?:^|_)mi(?:$|_)/.test(metric) || target?.unit === 'mi' ? value * 1.609 : value;
    return { name: occ.title, distance_km: Math.round(km * 100) / 100 };
  }
  const length = value && /\b(min|minute|duration|time)/.test(metric) ? value : minutes;
  if (!length || length <= 0) return null;
  if (JOURNAL.test(text)) return { name: occ.title, tool: 'journal', duration_min: length };
  if (MIND.test(text)) return { name: occ.title, tool: 'meditate', duration_min: length };
  return { name: occ.title, tool: 'timer', duration_min: length };
}

function fromShape(occ: OccurrenceWithActivity, now: string): OccurrenceSession | null {
  const item = plainItemFor(occ);
  if (!item) return null;
  return {
    blocks: [{ label: 'Today', items: [item] }],
    note: FALLBACK_NOTE,
    generated_at: now,
    version: 1,
    fallback: 'coach_unreachable',
  };
}

/** Pure: given what is on file, the plain version or null. Exported for the table test. */
export function buildFallbackSession(
  occ: OccurrenceWithActivity,
  prior: Prior,
  lastMissed: boolean,
  now = new Date().toISOString(),
): OccurrenceSession | null {
  return fromPrior(occ, prior, lastMissed, now) ?? fromShape(occ, now);
}

/** The reads, then the pure build. A read that fails costs the prior, never the plain block. */
export async function fallbackSessionFor(
  userId: string,
  occ: OccurrenceWithActivity,
): Promise<OccurrenceSession | null> {
  const [prior, history] = await Promise.all([
    getLatestSessionByTitle(userId, occ.title).catch((): Prior => null),
    listRecentLogsByTitle(userId, occ.title, 1).catch(() => []),
  ]);
  const lastMissed = history[0]?.log.items?.some((i) => i.done === false) ?? false;
  return buildFallbackSession(occ, prior, lastMissed);
}
