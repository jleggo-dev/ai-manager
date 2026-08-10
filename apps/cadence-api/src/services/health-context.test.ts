import { describe, expect, it } from 'vitest';
import type { HealthDigest } from '@cadence/shared';
import { renderHealthDigest } from './health-context.ts';
import { healthDigestBodySchema } from '../validation/health.ts';

const digest: HealthDigest = {
  periodDays: 90,
  totalWorkouts: 14,
  weeklyFrequency: 1.1,
  byType: [
    { type: 'running', count: 9, avgDurationMin: 38, avgDistanceKm: 5.8, lastISO: '2026-08-01T07:00:00Z' },
    { type: 'strength training', count: 5, avgDurationMin: 44, avgDistanceKm: null, lastISO: '2026-07-28T18:00:00Z' },
  ],
  recent: [{ type: 'running', start: '2026-08-01T07:00:00Z', durationMin: 41, distanceKm: 6.2 }],
};

describe('renderHealthDigest', () => {
  it('renders the compact block the coach reads', () => {
    const s = renderHealthDigest(digest, '2026-08-06T10:00:00Z');
    expect(s).toContain('Recent activity (Apple Health, last 90 days, shared 2026-08-06)');
    expect(s).toContain('14 workouts, ~1.1/week overall');
    expect(s).toContain('- running: 9× (~0.7/wk), avg 38 min, avg 5.8 km');
    expect(s).toContain('- strength training: 5× (~0.4/wk), avg 44 min');
    expect(s).not.toContain('strength training: 5×,'); // no empty distance slot
    expect(s).toContain('most recent: running, 2026-08-01, 41 min');
  });

  it('says so plainly when there are no workouts', () => {
    const s = renderHealthDigest({ ...digest, totalWorkouts: 0, byType: [], recent: [] });
    expect(s).toBe('Recent activity (Apple Health, last 90 days): no workouts recorded.');
  });

  const steps = { daysObserved: 88, avgPerDay: 15_900, avgPerDayLast7: 16_400, byWeek: [] };

  it('reports everyday movement alongside the workouts', () => {
    const s = renderHealthDigest({ ...digest, dailySteps: steps });
    expect(s).toContain('everyday movement: ~15,900 steps/day across 88 days, ~16,400/day this past week');
  });

  it('never calls a 16k-steps-a-day walker inactive just because they log no workouts', () => {
    // Workouts describe people who press start on a watch. Reading only those would have the coach
    // telling one of the most active users she has that she does nothing.
    const s = renderHealthDigest({ ...digest, totalWorkouts: 0, byType: [], recent: [], dailySteps: steps });
    expect(s).toContain('their phone did record everyday movement');
    expect(s).toContain('~15,900 steps/day');
  });
});

describe('healthDigestBodySchema', () => {
  it('accepts a valid body with optional sessionId', () => {
    expect(healthDigestBodySchema.safeParse({ digest }).success).toBe(true);
    expect(healthDigestBodySchema.safeParse({ digest, sessionId: 'abc-123' }).success).toBe(true);
  });

  it('accepts a step summary, and still accepts a digest without one', () => {
    // Absent means "not read" — every digest stored before steps existed has none, and a device
    // that refused only the step permission must still be able to share its workouts.
    const dailySteps = {
      daysObserved: 88,
      avgPerDay: 15_900,
      avgPerDayLast7: 16_400,
      byWeek: [{ weekStartISO: '2026-08-03', avgPerDay: 16_400, daysObserved: 7 }],
    };
    expect(healthDigestBodySchema.safeParse({ digest: { ...digest, dailySteps } }).success).toBe(true);
    expect(healthDigestBodySchema.safeParse({ digest }).success).toBe(true);
    // Raw daily samples are exactly what the digest is an abstraction over.
    const tooManyWeeks = { ...dailySteps, byWeek: Array.from({ length: 15 }, () => dailySteps.byWeek[0]) };
    expect(healthDigestBodySchema.safeParse({ digest: { ...digest, dailySteps: tooManyWeeks } }).success).toBe(false);
  });

  it('rejects oversized or malformed digests', () => {
    const tooManyTypes = { ...digest, byType: Array.from({ length: 26 }, () => digest.byType[0]) };
    expect(healthDigestBodySchema.safeParse({ digest: tooManyTypes }).success).toBe(false);
    expect(healthDigestBodySchema.safeParse({ digest: { ...digest, periodDays: 0 } }).success).toBe(false);
    expect(healthDigestBodySchema.safeParse({ digest: { ...digest, weeklyFrequency: 999 } }).success).toBe(false);
    expect(healthDigestBodySchema.safeParse({}).success).toBe(false);
  });
});
