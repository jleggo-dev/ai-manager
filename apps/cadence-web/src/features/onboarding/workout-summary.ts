/**
 * Workouts → the per-type summary the digest carries. Derived ON DEVICE, like everything else
 * that crosses this boundary: the server stores a shape, never the sessions behind it.
 *
 * Why this is not just an average. A flat mean over the whole 90-day window answers a question
 * nobody asked — it cannot tell a build-up from a taper, and five 5–6 km runs in one week vanish
 * into everything since mid-May. Someone training for a 50 km ultra was told "you're averaging
 * 4.3 km a run" in the same week he ran 5–6 km five times, and the number was correct. So each
 * type now carries three things instead of one:
 *
 *   - the period average, unchanged — it was never wrong, only wrong as the ONLY line;
 *   - the same figures over the trailing 28 days, the shape `dailySteps` has always had
 *     (`avgPerDayLast7` beside the 90-day mean). Two numbers side by side ARE the direction of
 *     travel, and they cost one more pass over data already in hand;
 *   - the bests, each with its date. Nothing anywhere computed a maximum before. A best is what
 *     makes "you've run 21 km before, 50 is a different animal but not an unknown one" sayable.
 *
 * Bounds mirror apps/cadence-api/src/validation/health.ts exactly, and they are applied per FIGURE
 * rather than per payload: the digest is validated as a whole on the server, so an unclamped
 * outlier from one bad row would reject the entire history — which the user only ever saw as
 * "I couldn't read Apple Health just now".
 */
import {
  DIGEST_RECENT_DAYS,
  type HealthDigestBest,
  type HealthDigestRecentWindow,
  type HealthDigestTypeSummary,
} from '@cadence/shared';
import type { Workout } from '../../lib/capability/index.ts';
import { isRecordedDistance } from '../../lib/capability/workout-distance.ts';
import { humanizeWorkoutType } from '../settings/health-import.ts';

export const MAX_TYPES = 25;
export const MAX_MINUTES = 1_440;
export const MAX_KM = 1_000;
/** Four weeks of total distance. A Grand Tour is ~3,500 km, so this is far above any real month. */
export const MAX_TOTAL_KM = 50_000;
export const MAX_TYPE_CHARS = 80;

const DAY_MS = 86_400_000;

export const round1 = (n: number): number => Math.round(n * 10) / 10;

export const clamp = (n: number | null, hi: number): number | null =>
  n == null || !Number.isFinite(n) ? null : Math.min(Math.max(n, 0), hi);

export function avg(nums: number[]): number | null {
  return nums.length ? round1(nums.reduce((a, b) => a + b, 0) / nums.length) : null;
}

/** Distances that are real evidence — the plugin's `?? 0` is filtered out here, once. */
const distancesOf = (list: Workout[]): number[] => list.map((w) => w.distanceKm).filter(isRecordedDistance);

/** Durations keep their looser filter: an implausible one is clamped, and only null is absent. */
const durationsOf = (list: Workout[]): number[] => list.map((w) => w.durationMin).filter((n): n is number => n != null);

/**
 * The best single session on one measure, with the day it happened.
 *
 * `list` arrives newest-first and ties are kept, not replaced, so a best equalled again last week
 * reports last week's date rather than the first time they ever did it. "12 km, back in March" and
 * "12 km, last Tuesday" are different facts and lead to different sessions.
 */
function bestOf(list: Workout[], pick: (w: Workout) => number | null | undefined, hi: number): HealthDigestBest | null {
  let best: { value: number; start: string } | null = null;
  for (const w of list) {
    const v = pick(w);
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) continue;
    if (!best || v > best.value) best = { value: v, start: w.start ?? '' };
  }
  if (!best) return null;
  const value = clamp(best.value, hi);
  return value == null ? null : { value, dateISO: best.start.slice(0, 10) };
}

/**
 * The trailing-28-day figures. `count: 0` is a real answer — a modality someone has not touched
 * this month is exactly the thing a 90-day mean hides — so this object is always returned.
 */
function recentWindow(list: Workout[], sinceMs: number): HealthDigestRecentWindow {
  const inWindow = list.filter((w) => {
    const t = Date.parse(w.start ?? '');
    return Number.isFinite(t) && t >= sinceMs;
  });
  const distances = distancesOf(inWindow);
  const total = distances.reduce((a, b) => a + b, 0);
  return {
    count: inWindow.length,
    avgDurationMin: clamp(avg(durationsOf(inWindow)), MAX_MINUTES),
    avgDistanceKm: clamp(avg(distances), MAX_KM),
    totalDistanceKm: distances.length ? clamp(round1(total), MAX_TOTAL_KM) : null,
  };
}

/** Bucket by humanized type, then derive the period figures, the recent window and the bests. */
export function summarizeWorkoutTypes(workouts: Workout[], nowMs: number): HealthDigestTypeSummary[] {
  const byType = new Map<string, Workout[]>();
  for (const w of workouts) {
    const t = humanizeWorkoutType(w.type);
    byType.set(t, [...(byType.get(t) ?? []), w]);
  }
  const sinceMs = nowMs - DIGEST_RECENT_DAYS * DAY_MS;
  return [...byType.entries()]
    .map(([type, unsorted]) => {
      // Sorted newest-first once, here: `lastISO` falls out of it and bests break ties recent-ward.
      const list = [...unsorted].sort((a, b) => (b.start ?? '').localeCompare(a.start ?? ''));
      return {
        type: type.slice(0, MAX_TYPE_CHARS),
        count: list.length,
        avgDurationMin: clamp(avg(durationsOf(list)), MAX_MINUTES),
        avgDistanceKm: clamp(avg(distancesOf(list)), MAX_KM),
        lastISO: list[0]?.start ?? '',
        last28: recentWindow(list, sinceMs),
        bestDistanceKm: bestOf(list, (w) => w.distanceKm, MAX_KM),
        bestDurationMin: bestOf(list, (w) => w.durationMin, MAX_MINUTES),
      };
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_TYPES);
}
