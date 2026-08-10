/**
 * The observed-activity half of `recent_activity` — what the person actually did in the world.
 *
 * **Why this exists.** Someone training for a 50 km ultra got a plan containing one 45-minute flat
 * walk a week and no running at all. His Apple Health showed ten runs in ninety days, averaging
 * 4.3 km and 36 minutes, the most recent of them the day before. The planner never saw any of it:
 * a first plan passed no activity data whatsoever, so `recent_activity` rendered as `""`, and the
 * only thing reading the health digest was the coach's CHAT context. The coach could describe his
 * running in conversation while the planner, minutes later, was working from an empty string.
 *
 * **Two sources, never conflated.** This payload sits ALONGSIDE the occurrence counts in
 * `recent_activity`, and the two answer different questions:
 *
 *   - observed_health (here) — what they did in the world, measured by their own devices.
 *     Independent of Cadence. Evidence of the capacity they ALREADY have.
 *   - the occurrence counts (services/replan.ts) — what they did against OUR plan.
 *
 * Merging them would be a new bug in the opposite direction: a person can be extremely active and
 * still miss every scheduled session, and a planner that cannot tell those apart will either ease
 * off someone who is thriving or build on sand for someone who is not.
 *
 * **Modality is the headline, not the frequency.** "Three sessions a week" describes the ultra
 * runner and a person who does chair yoga equally well. It was never the session count that made
 * the walking plan wrong — it was that nothing in the payload said he RUNS. So the types, their
 * distances and their durations lead, and the counts follow.
 */
import type { HealthDigest } from '@cadence/shared';
import { listHealthDigests, type StoredHealthDigest } from '../repos/health-digests.ts';

const DAY_MS = 86_400_000;
/** How far back the trend reaches, in sampled points (one per calendar week). */
const MAX_TREND_POINTS = 6;
/** Enough rows to find ~6 distinct weeks even when the client refreshes daily. */
const SERIES_ROWS = 60;
const MAX_MODALITIES = 8;

const day = (iso: string): string => iso.slice(0, 10);
const round1 = (n: number): number => Math.round(n * 10) / 10;

export interface ObservedModality {
  /** "running", "strength training" — the thing they actually do. */
  type: string;
  sessions: number;
  per_week: number;
  avg_duration_min: number | null;
  avg_distance_km: number | null;
  last: string;
}

export interface ObservedHealth {
  source: 'apple_health';
  what_this_is: string;
  as_of: string;
  period_days: number;
  /** Modality first — see the file header. Sorted by how much they actually do it. */
  trains: ObservedModality[];
  total_workouts: number;
  workouts_per_week: number;
  most_recent_workout: { type: string; date: string; duration_min: number | null; distance_km: number | null } | null;
  days_since_last_workout: number | null;
  daily_steps?: {
    what_this_is: string;
    days_observed: number;
    avg_per_day: number;
    avg_per_day_last_7: number | null;
    by_week: { week_starting: string; avg_per_day: number; days_observed: number }[];
  };
  /** Successive shares, oldest → newest. Absent when there is only one window on file. */
  trend?: { as_of: string; workouts_per_week: number; steps_avg_per_day: number | null }[];
}

const WHAT_THIS_IS =
  "Measured by this person's own phone/watch (Apple Health) and shared by them. This is what they " +
  'ACTUALLY did in the world over the period below, independent of any Cadence plan. Treat it as ' +
  'evidence of the capacity they already have and build FROM it — it is a floor, never a ceiling, ' +
  'and never a target to be reached.';

/**
 * The label that keeps the OTHER half of `recent_activity` honest.
 *
 * The occurrence counts sit at the top level of that payload — where the synthesize_plan template
 * already refers to them by name — so they cannot be moved under a heading of their own without
 * breaking the prompt. This line does the labelling instead, and it earns its place: done/skipped/
 * missed count Cadence's scheduled sessions and nothing else, so a person who trains constantly
 * and ignores our schedule looks identical to one who has stopped moving.
 */
export const PLAN_COUNTS_NOTE =
  "done / skipped / missed / scheduled and consistency_last_7_days count occurrences of CADENCE's " +
  'own plan — how they engaged with what we asked of them. They are NOT a record of everything ' +
  'this person did. observed_health is that record; where the two disagree, both are true.';

const STEPS_WHAT_THIS_IS =
  'Everyday movement outside recorded workouts. A high step count with few workouts means an active ' +
  'person who does not press start on a watch, NOT a sedentary one.';

function modalities(digest: HealthDigest): ObservedModality[] {
  const weeks = Math.max(1, digest.periodDays / 7);
  return digest.byType.slice(0, MAX_MODALITIES).map((t) => ({
    type: t.type,
    sessions: t.count,
    per_week: round1(t.count / weeks),
    avg_duration_min: t.avgDurationMin,
    avg_distance_km: t.avgDistanceKm,
    last: day(t.lastISO),
  }));
}

function mostRecent(
  digest: HealthDigest,
  nowMs: number,
): Pick<ObservedHealth, 'most_recent_workout' | 'days_since_last_workout'> {
  const r = digest.recent[0];
  if (!r) return { most_recent_workout: null, days_since_last_workout: null };
  const t = Date.parse(r.start);
  return {
    most_recent_workout: {
      type: r.type,
      date: day(r.start),
      duration_min: r.durationMin,
      distance_km: r.distanceKm,
    },
    days_since_last_workout: Number.isFinite(t) ? Math.max(0, Math.floor((nowMs - t) / DAY_MS)) : null,
  };
}

/**
 * One point per calendar week, oldest → newest.
 *
 * Each stored row is a rolling 90-day window, so rows a day apart say almost the same thing —
 * sampling weekly is what makes drift visible instead of noise. The newest row is the headline
 * above and is excluded here, so the trend is strictly "and before that…".
 */
function trendFromSeries(rows: StoredHealthDigest[]): ObservedHealth['trend'] {
  const seen = new Set<string>();
  const points: NonNullable<ObservedHealth['trend']> = [];
  for (const row of rows.slice(1)) {
    const t = Date.parse(row.createdAt);
    if (!Number.isFinite(t)) continue;
    // ISO-ish week key: the Monday of the row's week.
    const d = new Date(t);
    const monday = new Date(t - ((d.getUTCDay() + 6) % 7) * DAY_MS).toISOString().slice(0, 10);
    if (seen.has(monday)) continue;
    seen.add(monday);
    points.push({
      as_of: day(row.createdAt),
      workouts_per_week: row.digest.weeklyFrequency,
      steps_avg_per_day: row.digest.dailySteps?.avgPerDay ?? null,
    });
    if (points.length >= MAX_TREND_POINTS) break;
  }
  return points.length ? points.reverse() : undefined;
}

/** Shape one stored digest (plus the series behind it) into the planner payload. */
export function toObservedHealth(rows: StoredHealthDigest[], nowMs = Date.now()): ObservedHealth | null {
  const head = rows[0];
  if (!head) return null;
  const { digest } = head;
  // A digest with no workouts AND no steps is an empty read, not a fact about the person. Sending
  // it would tell the planner "they do nothing", which is exactly the wrong lesson to draw from
  // a phone that simply had nothing to give.
  if (!digest.totalWorkouts && !digest.dailySteps) return null;

  const steps = digest.dailySteps;
  const trend = trendFromSeries(rows);
  return {
    source: 'apple_health',
    what_this_is: WHAT_THIS_IS,
    as_of: day(head.createdAt),
    period_days: digest.periodDays,
    trains: modalities(digest),
    total_workouts: digest.totalWorkouts,
    workouts_per_week: digest.weeklyFrequency,
    ...mostRecent(digest, nowMs),
    ...(steps
      ? {
          daily_steps: {
            what_this_is: STEPS_WHAT_THIS_IS,
            days_observed: steps.daysObserved,
            avg_per_day: steps.avgPerDay,
            avg_per_day_last_7: steps.avgPerDayLast7,
            by_week: steps.byWeek.map((w) => ({
              week_starting: w.weekStartISO,
              avg_per_day: w.avgPerDay,
              days_observed: w.daysObserved,
            })),
          },
        }
      : {}),
    ...(trend ? { trend } : {}),
  };
}

/**
 * The planner's view of Apple Health, or null when there is nothing worth saying.
 *
 * Never throws: a health read that fails must not be able to stop a plan being built. The plan is
 * worse without it, and no plan at all is worse still.
 */
export async function observedHealthForPlanning(userId: string): Promise<ObservedHealth | null> {
  try {
    return toObservedHealth(await listHealthDigests(userId, SERIES_ROWS));
  } catch (err) {
    console.error('[observedHealthForPlanning]', err);
    return null;
  }
}
