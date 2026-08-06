import { describe, expect, it } from 'vitest';
import type { Workout } from '../../lib/capability/index.ts';
import { buildDigestFromWorkouts } from './health-digest.ts';

const run = (start: string, km: number, min: number): Workout => ({
  type: 'HKWorkoutActivityTypeRunning',
  distanceKm: km,
  durationMin: min,
  start,
});
const lift = (start: string, min: number): Workout => ({
  type: 'HKWorkoutActivityTypeTraditionalStrengthTraining',
  durationMin: min,
  start,
});

describe('buildDigestFromWorkouts', () => {
  it('aggregates by humanized type with averages and weekly frequency', () => {
    const d = buildDigestFromWorkouts(
      [
        run('2026-07-01T08:00:00Z', 5, 30),
        run('2026-07-08T08:00:00Z', 7, 40),
        run('2026-07-15T08:00:00Z', 6, 35),
        lift('2026-07-05T18:00:00Z', 45),
      ],
      28,
    );
    expect(d.totalWorkouts).toBe(4);
    expect(d.periodDays).toBe(28);
    expect(d.weeklyFrequency).toBe(1); // 4 workouts / 4 weeks
    const running = d.byType.find((t) => t.type === 'running')!;
    expect(running.count).toBe(3);
    expect(running.avgDistanceKm).toBe(6);
    expect(running.avgDurationMin).toBe(35);
    expect(running.lastISO).toBe('2026-07-15T08:00:00Z');
    const strength = d.byType.find((t) => t.type === 'strength training')!;
    expect(strength.count).toBe(1);
    expect(strength.avgDistanceKm).toBeNull();
  });

  it('sorts types by count and recent newest-first, capped at 5', () => {
    const many = Array.from({ length: 9 }, (_, i) => run(`2026-07-0${i + 1}T08:00:00Z`, 5, 30));
    const d = buildDigestFromWorkouts([lift('2026-07-02T18:00:00Z', 45), ...many], 90);
    expect(d.byType[0]?.type).toBe('running');
    expect(d.recent).toHaveLength(5);
    expect(d.recent[0]?.start).toBe('2026-07-09T08:00:00Z');
    expect(d.recent[0]?.type).toBe('running');
  });

  it('handles the empty case', () => {
    const d = buildDigestFromWorkouts([], 90);
    expect(d.totalWorkouts).toBe(0);
    expect(d.weeklyFrequency).toBe(0);
    expect(d.byType).toEqual([]);
    expect(d.recent).toEqual([]);
  });

  it('never exceeds the server bound of 25 types', () => {
    const zoo = Array.from({ length: 40 }, (_, i) => ({
      type: `HKWorkoutActivityTypeSport${i}`,
      durationMin: 30,
      start: '2026-07-01T08:00:00Z',
    }));
    expect(buildDigestFromWorkouts(zoo, 90).byType).toHaveLength(25);
  });
});
