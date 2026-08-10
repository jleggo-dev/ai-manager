import { describe, expect, it } from 'vitest';
import type { HealthDigest } from '@cadence/shared';
import { toObservedHealth, PLAN_COUNTS_NOTE } from './observed-health.ts';
import type { StoredHealthDigest } from '../repos/health-digests.ts';

/**
 * The real case this whole path exists for: someone training for a 50 km Spartan Ultra Beast whose
 * Apple Health held ten runs in ninety days, the most recent of them the day before — and who was
 * handed a plan of one 45-minute flat walk a week, because the planner received `recent_activity: ""`.
 */
const ultraRunner: HealthDigest = {
  periodDays: 90,
  totalWorkouts: 12,
  weeklyFrequency: 0.9,
  byType: [
    { type: 'running', count: 10, avgDurationMin: 36, avgDistanceKm: 4.3, lastISO: '2026-08-09T06:30:00Z' },
    {
      type: 'functional strength training',
      count: 2,
      avgDurationMin: 40,
      avgDistanceKm: null,
      lastISO: '2026-07-20T18:00:00Z',
    },
  ],
  recent: [{ type: 'running', start: '2026-08-09T06:30:00Z', durationMin: 38, distanceKm: 4.6 }],
  dailySteps: {
    daysObserved: 88,
    avgPerDay: 15_900,
    avgPerDayLast7: 16_400,
    byWeek: [
      { weekStartISO: '2026-07-27', avgPerDay: 15_200, daysObserved: 7 },
      { weekStartISO: '2026-08-03', avgPerDay: 16_400, daysObserved: 7 },
    ],
  },
};

const row = (digest: HealthDigest, createdAt: string): StoredHealthDigest => ({ digest, createdAt });
const NOW = Date.parse('2026-08-10T09:00:00Z');

describe('toObservedHealth', () => {
  it('leads with WHAT they train, not how often', () => {
    // A frequency count alone would not have prevented the walking plan: "three sessions a week"
    // describes an ultra runner and someone doing chair yoga equally well. The modality is the
    // load-bearing fact, so it has to be impossible to miss in the payload.
    const o = toObservedHealth([row(ultraRunner, '2026-08-10T05:00:00Z')], NOW)!;
    expect(o.trains[0]).toMatchObject({
      type: 'running',
      sessions: 10,
      avg_distance_km: 4.3,
      avg_duration_min: 36,
      last: '2026-08-09',
    });
    expect(o.trains[0]?.per_week).toBeCloseTo(0.8, 1);
    expect(o.most_recent_workout).toMatchObject({ type: 'running', date: '2026-08-09' });
    expect(o.days_since_last_workout).toBe(1);
  });

  it('carries everyday movement, which for many people IS the activity', () => {
    const o = toObservedHealth([row(ultraRunner, '2026-08-10T05:00:00Z')], NOW)!;
    expect(o.daily_steps).toMatchObject({ days_observed: 88, avg_per_day: 15_900, avg_per_day_last_7: 16_400 });
    expect(o.daily_steps?.by_week.at(-1)).toEqual({
      week_starting: '2026-08-03',
      avg_per_day: 16_400,
      days_observed: 7,
    });
  });

  it('names its own provenance and tells the reader it is a floor, not a ceiling', () => {
    // The synthesize_plan template does not own this vocabulary, so the payload has to explain
    // itself — otherwise "recent activity" reads as a cap on what to prescribe.
    const o = toObservedHealth([row(ultraRunner, '2026-08-10T05:00:00Z')], NOW)!;
    expect(o.source).toBe('apple_health');
    expect(o.what_this_is).toMatch(/floor, never a ceiling/);
    expect(o.as_of).toBe('2026-08-10');
  });

  it('turns the stored series into a trend, one point per week', () => {
    // Every row is a rolling 90-day window, so rows a day apart say nearly the same thing. Weekly
    // sampling is what makes drift visible rather than noise.
    const o = toObservedHealth(
      [
        row(ultraRunner, '2026-08-10T05:00:00Z'), // the headline above — never repeated in the trend
        row({ ...ultraRunner, weeklyFrequency: 0.8 }, '2026-08-09T05:00:00Z'),
        row({ ...ultraRunner, weeklyFrequency: 0.7 }, '2026-08-08T05:00:00Z'), // same week as 08-09 — dropped
        row({ ...ultraRunner, weeklyFrequency: 0.5 }, '2026-07-29T05:00:00Z'),
        row({ ...ultraRunner, weeklyFrequency: 0.2 }, '2026-07-21T05:00:00Z'),
      ],
      NOW,
    )!;
    expect(o.trend?.map((p) => p.workouts_per_week)).toEqual([0.2, 0.5, 0.8]);
    expect(o.trend?.map((p) => p.as_of)).toEqual(['2026-07-21', '2026-07-29', '2026-08-09']);
  });

  it('omits the trend when only one window is on file', () => {
    expect(toObservedHealth([row(ultraRunner, '2026-08-10T05:00:00Z')], NOW)!.trend).toBeUndefined();
  });

  it('says nothing at all rather than "they do nothing"', () => {
    // An empty read is a fact about the phone, not the person. Sending it would teach the planner
    // the single worst lesson available — build small, they are sedentary.
    expect(toObservedHealth([])).toBeNull();
    const empty: HealthDigest = { periodDays: 90, totalWorkouts: 0, weeklyFrequency: 0, byType: [], recent: [] };
    expect(toObservedHealth([row(empty, '2026-08-10T05:00:00Z')], NOW)).toBeNull();
  });

  it('still speaks for the walker with no recorded workouts', () => {
    // 16k steps a day and never pressing start on a watch: workouts-only, this person is invisible.
    const walker: HealthDigest = {
      periodDays: 90,
      totalWorkouts: 0,
      weeklyFrequency: 0,
      byType: [],
      recent: [],
      dailySteps: { daysObserved: 90, avgPerDay: 16_100, avgPerDayLast7: 15_800, byWeek: [] },
    };
    const o = toObservedHealth([row(walker, '2026-08-10T05:00:00Z')], NOW)!;
    expect(o.daily_steps?.avg_per_day).toBe(16_100);
    expect(o.trains).toEqual([]);
    expect(o.most_recent_workout).toBeNull();
  });
});

describe('PLAN_COUNTS_NOTE', () => {
  it('keeps the two halves of recent_activity from being read as one', () => {
    // A person can train constantly and still miss every session we scheduled. A planner that
    // cannot tell the sources apart will ease off someone who is thriving.
    expect(PLAN_COUNTS_NOTE).toMatch(/observed_health/);
    expect(PLAN_COUNTS_NOTE).toMatch(/NOT a record of everything/);
  });
});
