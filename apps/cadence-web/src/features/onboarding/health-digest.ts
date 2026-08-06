/**
 * Build the compact Apple Health digest the onboarding offer sends (confirm-first).
 * Pure aggregation over the capability seam's Workout shape — the digest is the parsed
 * abstraction (workouts by type/week), never raw samples. Server bounds mirror
 * apps/cadence-api/src/validation/health.ts: ≤25 types, ≤10 recent.
 */
import type { HealthDigest, HealthDigestTypeSummary } from '@cadence/shared';
import type { Workout } from '../../lib/capability/index.ts';
import { humanizeWorkoutType } from '../settings/health-import.ts';

export const DIGEST_PERIOD_DAYS = 90;
export const HEALTH_OFFER_FLAG_KEY = 'cadence.healthOffer'; // 'done' | 'dismissed'

/** True once the user has answered the onboarding offer either way. */
export function healthOfferAnswered(): boolean {
  const v = localStorage.getItem(HEALTH_OFFER_FLAG_KEY);
  return v === 'done' || v === 'dismissed';
}
const MAX_TYPES = 25;
const MAX_RECENT = 5;

const round1 = (n: number) => Math.round(n * 10) / 10;

function avg(nums: number[]): number | null {
  return nums.length ? round1(nums.reduce((a, b) => a + b, 0) / nums.length) : null;
}

export function buildDigestFromWorkouts(workouts: Workout[], periodDays = DIGEST_PERIOD_DAYS): HealthDigest {
  const byType = new Map<string, Workout[]>();
  for (const w of workouts) {
    const t = humanizeWorkoutType(w.type);
    byType.set(t, [...(byType.get(t) ?? []), w]);
  }
  const weeks = Math.max(1, periodDays / 7);
  const typeSummaries: HealthDigestTypeSummary[] = [...byType.entries()]
    .map(([type, list]) => ({
      type,
      count: list.length,
      avgDurationMin: avg(list.map((w) => w.durationMin).filter((n): n is number => n != null)),
      avgDistanceKm: avg(list.map((w) => w.distanceKm).filter((n): n is number => n != null)),
      lastISO:
        list
          .map((w) => w.start)
          .sort()
          .at(-1) ?? '',
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, MAX_TYPES);

  const recent = [...workouts]
    .sort((a, b) => b.start.localeCompare(a.start))
    .slice(0, MAX_RECENT)
    .map((w) => ({
      type: humanizeWorkoutType(w.type),
      start: w.start,
      durationMin: w.durationMin ?? null,
      distanceKm: w.distanceKm ?? null,
    }));

  return {
    periodDays,
    totalWorkouts: workouts.length,
    weeklyFrequency: round1(workouts.length / weeks),
    byType: typeSummaries,
    recent,
  };
}
