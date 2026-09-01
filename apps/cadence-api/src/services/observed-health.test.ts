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
    {
      type: 'running',
      count: 10,
      avgDurationMin: 36,
      avgDistanceKm: 4.3,
      lastISO: '2026-08-09T06:30:00Z',
      last28: { count: 5, avgDurationMin: 31, avgDistanceKm: 5.5, totalDistanceKm: 27.4 },
      bestDistanceKm: { value: 21.1, dateISO: '2026-03-14' },
      bestDurationMin: { value: 128, dateISO: '2026-03-14' },
    },
    {
      type: 'functional strength training',
      count: 2,
      avgDurationMin: 40,
      avgDistanceKm: null,
      lastISO: '2026-07-20T18:00:00Z',
      last28: { count: 0, avgDurationMin: null, avgDistanceKm: null, totalDistanceKm: null },
      bestDistanceKm: null,
      bestDurationMin: { value: 52, dateISO: '2026-07-20' },
    },
  ],
  recent: [
    { type: 'running', start: '2026-08-09T06:30:00Z', durationMin: 38, distanceKm: 4.6 },
    { type: 'running', start: '2026-08-07T06:30:00Z', durationMin: 31, distanceKm: 5.4 },
    { type: 'running', start: '2026-08-04T06:30:00Z', durationMin: 33, distanceKm: 5.8 },
  ],
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

const row = (digest: HealthDigest, createdAt: string | Date): StoredHealthDigest => ({ digest, createdAt });
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

  /**
   * The 4.3 km itself: correct over ninety days, and useless to a man who ran 5–6 km five times
   * that week. The period average stays — it was only ever wrong as the ONLY number — and the
   * recent pair goes beside it, exactly as steps have always had avg_per_day_last_7.
   */
  it('ships the last four weeks beside the period average', () => {
    const o = toObservedHealth([row(ultraRunner, '2026-08-10T05:00:00Z')], NOW)!;
    expect(o.trains[0]?.avg_distance_km).toBe(4.3);
    expect(o.trains[0]?.last_28_days).toEqual({
      sessions: 5,
      avg_duration_min: 31,
      avg_distance_km: 5.5,
      total_distance_km: 27.4,
    });
    // Nothing lately is said as a zero, not as a missing window.
    expect(o.trains[1]?.last_28_days?.sessions).toBe(0);
  });

  it('carries the previous bests, dated, which nothing computed before', () => {
    // "You've run 21 km before, 50 km is a different animal but not an unknown one" is only
    // sayable if a maximum exists somewhere. It never did.
    const o = toObservedHealth([row(ultraRunner, '2026-08-10T05:00:00Z')], NOW)!;
    expect(o.trains[0]?.best_distance_km).toEqual({ value: 21.1, date: '2026-03-14' });
    expect(o.trains[0]?.best_duration_min).toEqual({ value: 128, date: '2026-03-14' });
    expect(o.trains[1]?.best_distance_km).toBeNull(); // lifting has no distance to be best at
  });

  it('passes on every dated session it holds, not only the newest', () => {
    const o = toObservedHealth([row(ultraRunner, '2026-08-10T05:00:00Z')], NOW)!;
    expect(o.recent_workouts.map((w) => w.date)).toEqual(['2026-08-09', '2026-08-07', '2026-08-04']);
    expect(o.recent_workouts[1]).toEqual({ date: '2026-08-07', type: 'running', duration_min: 31, distance_km: 5.4 });
  });

  it('reports nothing rather than a made-up zero for a digest stored before these fields', () => {
    // Stored digests are jsonb and are re-read for months. Absent means "not derived".
    const old = {
      ...ultraRunner,
      byType: [{ ...ultraRunner.byType[0]!, last28: undefined, bestDistanceKm: undefined }],
    };
    const o = toObservedHealth([row(old, '2026-08-10T05:00:00Z')], NOW)!;
    expect(o.trains[0]?.last_28_days).toBeNull();
    expect(o.trains[0]?.best_distance_km).toBeNull();
  });

  it('tells the reader which figures describe now and which describe the baseline', () => {
    // A field nothing explains gets read as whatever the model expects. The payload has to say
    // that the recent pair leads, or the biggest number on the page wins again.
    const o = toObservedHealth([row(ultraRunner, '2026-08-10T05:00:00Z')], NOW)!;
    expect(o.what_this_is).toMatch(/last_28_days and recent_workouts are what they are doing NOW/);
    expect(o.what_this_is).toMatch(/never themselves a target/);
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

describe('toObservedHealth with Date-typed created_at', () => {
  // postgres.js returns timestamptz columns as Date objects while the hand-written row generics
  // say string. This file threw on exactly that (2026-09-01, found by a live probe) and the
  // catch in observedHealthForPlanning turned it into observed_health quietly missing from every
  // plan synthesis — the "planned for as though nobody had ever seen him move" failure. Dates in,
  // no throw, correct days out.
  it('survives Date rows and still dates the payload and its trend', () => {
    const rows = [
      row(ultraRunner, new Date('2026-08-10T05:00:00Z')),
      row(ultraRunner, new Date('2026-08-03T05:00:00Z')),
      row(ultraRunner, new Date('2026-07-27T05:00:00Z')),
    ];
    const o = toObservedHealth(rows, NOW)!;
    expect(o.as_of).toBe('2026-08-10');
    expect(o.trend?.length).toBe(2);
    expect(o.trend?.[0]?.as_of).toBe('2026-07-27');
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
