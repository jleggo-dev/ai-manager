import type { StreakDay, StreakView } from '@cadence/shared';
import { getUser, setStreakState } from '../repos/users.ts';
import { listOccurrences } from '../repos/occurrences.ts';
import { advanceStreak, computeStreakView, initialStreakState } from './metrics.ts';

/** Bound the finalize window so a long-dormant account can't trigger a huge back-walk; a gap
 *  older than this simply isn't retro-scored (the streak was long gone anyway). */
const MAX_FINALIZE_DAYS = 60;
const DAY = 86_400_000;
const isoDay = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const isoToUtcMs = (iso: string): number => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y!, m! - 1, d!);
};

/**
 * Evaluate the reinstated streak (Req 4) and return the client-facing view. FORWARD-ONLY: it
 * finalizes only whole past days in `(last_evaluated, yesterday]` (today stays provisional), then
 * persists — so it's idempotent within a day and a past freeze decision is never re-derived.
 * Engagement today = a `done` occurrence that day; explicit check-ins and episode-shielding land
 * in Phase C (the day-builder already carries the `engaged`/`inEpisode` flags for them).
 *
 * Safe to call on every GET /plan: a handful of local reads + at most one UPDATE (only when there
 * are new days to finalize). Never throws for a missing 0015 column at read time — it falls back
 * to a seeded initial state; only the persist path needs the column (deploy after the migration).
 */
export async function evaluateStreak(userId: string): Promise<StreakView> {
  const user = await getUser(userId);
  const prior = user?.streak_state ?? initialStreakState();

  const now = new Date();
  const todayMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const yesterdayMs = todayMs - DAY;

  // First day to finalize: the day after last_evaluated, or (new user) just yesterday. Clamped so
  // we never walk more than MAX_FINALIZE_DAYS back.
  const clampMs = todayMs - MAX_FINALIZE_DAYS * DAY;
  let startMs = prior.last_evaluated ? isoToUtcMs(prior.last_evaluated) + DAY : yesterdayMs;
  if (startMs < clampMs) startMs = clampMs;

  // Pull occurrences across the finalize window PLUS today (today feeds the provisional view).
  const occ = await listOccurrences(userId, isoDay(Math.min(startMs, todayMs)), isoDay(todayMs));
  const dueDays = new Set<string>();
  const doneDays = new Set<string>();
  for (const o of occ) {
    // The DB driver hands back `date` columns as JS Date objects; normalize to YYYY-MM-DD the
    // same way rollingConsistency does so the keys match the day-walk below.
    const d = new Date(o.date).toISOString().slice(0, 10);
    // `skipped` is an acknowledged pass — it deliberately does NOT create due-pressure.
    if (o.status === 'pending' || o.status === 'done' || o.status === 'missed') dueDays.add(d);
    if (o.status === 'done') doneDays.add(d);
  }
  const mkDay = (dateIso: string): StreakDay => ({
    date: dateIso,
    due: dueDays.has(dateIso),
    engaged: doneDays.has(dateIso),
    inEpisode: false, // Phase C feeds active episodes here to shield no-shows from becoming slips
  });

  const finalized: StreakDay[] = [];
  for (let ms = startMs; ms <= yesterdayMs; ms += DAY) finalized.push(mkDay(isoDay(ms)));

  const next = advanceStreak(prior, finalized);
  if (finalized.length > 0) {
    await setStreakState(userId, next).catch((e) => console.error('[evaluateStreak:persist]', e));
  }

  return computeStreakView(next, mkDay(isoDay(todayMs)));
}
