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
import { isoDay } from './iso-day.ts';

const DAY_MS = 86_400_000;
/** How far back the trend reaches, in sampled points (one per calendar week). */
const MAX_TREND_POINTS = 6;
/** Enough rows to find ~6 distinct weeks even when the client refreshes daily. */
const SERIES_ROWS = 60;
const MAX_MODALITIES = 8;

// isoDay, not a local `.slice` — postgres.js hands `created_at` back as a Date while the row type
// says string, and this file threw on exactly that (2026-09-01, live probe), silently starving
// plan synthesis of observed_health for anyone with real digests. Same lesson isoDay itself
// records from 2026-08-16; this was the holdout.
const day = (iso: string | Date): string => isoDay(iso);
const round1 = (n: number): number => Math.round(n * 10) / 10;

/** One previous best and the day it was set. Both halves matter — see the digest's own comment. */
export interface ObservedBest {
  value: number;
  date: string;
}

export interface ObservedModality {
  /** "running", "strength training" — the thing they actually do. */
  type: string;
  sessions: number;
  per_week: number;
  avg_duration_min: number | null;
  avg_distance_km: number | null;
  last: string;
  /**
   * The same figures over the trailing four weeks. Null only when the digest predates the field —
   * `sessions: 0` is how "none lately" is said. Steps have always had this recency half
   * (`avg_per_day_last_7`); training had none, so the planner could not tell a build-up from a
   * taper and read a man mid-build as a 4.3 km jogger.
   */
  last_28_days: {
    sessions: number;
    avg_duration_min: number | null;
    avg_distance_km: number | null;
    total_distance_km: number | null;
  } | null;
  /** Furthest single session, ever, inside the period. */
  best_distance_km: ObservedBest | null;
  /** Longest single session by time. */
  best_duration_min: ObservedBest | null;
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
  /**
   * The individual sessions, newest first — not a statistic, the list. Five 5–6 km runs in nine
   * days is visible the moment they stop being collapsed into a mean, and the digest has always
   * carried them; only the newest one was ever read.
   */
  recent_workouts: { date: string; type: string; duration_min: number | null; distance_km: number | null }[];
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
  'ACTUALLY did in the world over the period below, independent of any Cadence plan. It is ' +
  'evidence of the capacity they already have, and never a target to be reached. The figures ' +
  'cover two spans: last_28_days and ' +
  'recent_workouts are what they are doing NOW, and the period-long averages are the longer ' +
  'baseline behind them — a build-up and a taper produce the same average, so plan from the ' +
  'recent pair and the dated sessions. best_distance_km and best_duration_min are things this ' +
  'person has ALREADY done, with the date they did them; they size what is realistic and are ' +
  'never themselves a target.';

/**
 * The label that keeps the OTHER half of `recent_activity` honest.
 *
 * The occurrence counts sit at the top level of that payload — where the synthesize_plan template
 * already refers to them by name — so they cannot be moved under a heading of their own without
 * breaking the prompt. This line does the labelling instead, and it earns its place: done/skipped/
 * missed count Cadence's scheduled sessions and nothing else, so a person who trains constantly
 * and ignores our schedule looks identical to one who has stopped moving.
 *
 * It also says what `missed` MEANS, because the app never writes that status — `planEngagementCounts`
 * derives it from past-due, still-pending sessions — and an undefined counter invites the model to
 * read it as a deliberate no-show.
 */
export const PLAN_COUNTS_NOTE =
  "done / skipped / missed / scheduled and consistency_last_7_days count occurrences of CADENCE's " +
  'own plan — how they engaged with what we asked of them. They are NOT a record of everything ' +
  'this person did. observed_health is that record; where the two disagree, both are true. ' +
  "These four counts cover the sessions we asked them to DO; the app's own tracking tasks (meal " +
  'logs, weigh-ins) are not in them, and the food signal is reported separately as food_log. ' +
  'missed means scheduled, now past due, and never marked done — it is not a statement about why.';

const STEPS_WHAT_THIS_IS =
  'Everyday movement outside recorded workouts. A high step count with few workouts means an active ' +
  'person who does not press start on a watch, NOT a sedentary one.';

/** Absent stays absent: a digest built before bests existed must not report a null-valued one. */
const best = (b: HealthDigest['byType'][number]['bestDistanceKm']): ObservedBest | null =>
  b ? { value: b.value, date: b.dateISO } : null;

function modalities(digest: HealthDigest): ObservedModality[] {
  const weeks = Math.max(1, digest.periodDays / 7);
  return digest.byType.slice(0, MAX_MODALITIES).map((t) => ({
    type: t.type,
    sessions: t.count,
    per_week: round1(t.count / weeks),
    avg_duration_min: t.avgDurationMin,
    avg_distance_km: t.avgDistanceKm,
    last: day(t.lastISO),
    last_28_days: t.last28
      ? {
          sessions: t.last28.count,
          avg_duration_min: t.last28.avgDurationMin,
          avg_distance_km: t.last28.avgDistanceKm,
          total_distance_km: t.last28.totalDistanceKm,
        }
      : null,
    best_distance_km: best(t.bestDistanceKm),
    best_duration_min: best(t.bestDurationMin),
  }));
}

/**
 * The newest session, the days since it, and the whole dated list.
 *
 * `most_recent_workout` stays exactly as it was — the planner template has read it since this file
 * shipped — and `recent_workouts` is the four sessions behind it that nothing ever looked at.
 */
function recentSessions(
  digest: HealthDigest,
  nowMs: number,
): Pick<ObservedHealth, 'most_recent_workout' | 'recent_workouts' | 'days_since_last_workout'> {
  const recent_workouts = digest.recent.map((r) => ({
    date: day(r.start),
    type: r.type,
    duration_min: r.durationMin,
    distance_km: r.distanceKm,
  }));
  const r = digest.recent[0];
  if (!r) return { most_recent_workout: null, recent_workouts, days_since_last_workout: null };
  const t = Date.parse(r.start);
  return {
    most_recent_workout: {
      type: r.type,
      date: day(r.start),
      duration_min: r.durationMin,
      distance_km: r.distanceKm,
    },
    recent_workouts,
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
    const t = new Date(row.createdAt).getTime(); // string or Date — see `day` above
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
    ...recentSessions(digest, nowMs),
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
