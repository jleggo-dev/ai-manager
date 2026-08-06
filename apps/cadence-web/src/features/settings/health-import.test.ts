import { describe, it, expect } from 'vitest';
import { humanizeWorkout, workoutLogText } from './health-import.ts';

describe('Apple Health workout → adhoc log text', () => {
  it('humanizes a HealthKit run with distance and duration', () => {
    expect(humanizeWorkout({ type: 'running', distanceKm: 5.2, durationMin: 31, start: '2026-08-05T07:00:00Z' })).toBe(
      'running, 5.2 km, 31 min',
    );
  });

  it('splits camelCase types and drops the HK prefix', () => {
    expect(humanizeWorkout({ type: 'HKWorkoutActivityTypeTraditionalStrengthTraining', start: '' })).toBe(
      'strength training',
    );
  });

  it('log text carries the provenance marker the coach can see', () => {
    expect(workoutLogText({ type: 'yoga', durationMin: 20, start: '2026-08-05T07:00:00Z' })).toBe(
      'yoga, 20 min (from Apple Health)',
    );
  });
});
