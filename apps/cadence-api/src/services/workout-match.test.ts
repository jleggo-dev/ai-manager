import { describe, expect, it } from 'vitest';
import { matchWorkoutToActivity, workoutMatchesActivity, workoutValue } from './workout-match.ts';

const act = (over: Partial<Parameters<typeof workoutMatchesActivity>[1]> = {}) => ({
  activity_id: 'a1',
  title: 'Long run - building time on feet',
  category: 'running',
  completion_source: 'healthkit',
  ...over,
});

/**
 * The owner's actual Saturday: a 77-minute run recorded by the watch, pushed to us, and a plan
 * that still showed the run as pending and waited to be told. `completion_source: 'healthkit'`
 * had been written on every synthesis and read by nothing.
 */
describe('workoutMatchesActivity', () => {
  it('ticks the run that was planned for it', () => {
    expect(workoutMatchesActivity({ type: 'running', duration_min: 77, distance_km: 8.78 }, act())).toBe(true);
  });

  it('will not tick a session that does not claim to complete from a device', () => {
    // A self-reported session is the person's to close, however much the watch saw.
    expect(workoutMatchesActivity({ type: 'running' }, act({ completion_source: 'self_report' }))).toBe(false);
    expect(workoutMatchesActivity({ type: 'running' }, act({ completion_source: null }))).toBe(false);
  });

  it('will not let one kind of session claim another kind of workout', () => {
    expect(workoutMatchesActivity({ type: 'walking' }, act())).toBe(false);
    expect(workoutMatchesActivity({ type: 'running' }, act({ category: 'strength' }))).toBe(false);
    expect(workoutMatchesActivity({ type: 'cycling' }, act({ category: 'swimming' }))).toBe(false);
  });

  it('reads HealthKit type spellings as they actually arrive', () => {
    expect(workoutMatchesActivity({ type: 'traditional strength training' }, act({ category: 'strength' }))).toBe(true);
    expect(workoutMatchesActivity({ type: 'mind and body' }, act({ category: 'yoga' }))).toBe(true);
    expect(workoutMatchesActivity({ type: 'cross training' }, act({ category: 'mixed' }))).toBe(true);
  });

  it('falls back to the title only when no category was set', () => {
    expect(workoutMatchesActivity({ type: 'running' }, act({ category: null }))).toBe(true);
    // With a category present the prose title is ignored — the coach writes anything there.
    expect(workoutMatchesActivity({ type: 'running' }, act({ category: 'strength' }))).toBe(false);
  });

  it('ignores a workout with no type at all', () => {
    expect(workoutMatchesActivity({ type: '' }, act())).toBe(false);
  });
});

describe('matchWorkoutToActivity', () => {
  it('refuses to choose when two sessions could both claim it', () => {
    // Ticking the wrong one writes a false record of someone's week that they may never notice.
    const two = [act({ activity_id: 'a1' }), act({ activity_id: 'a2', title: 'Easy run' })];
    expect(matchWorkoutToActivity({ type: 'running' }, two)).toBeNull();
  });

  it('picks the only real candidate, ignoring the noise around it', () => {
    const mixed = [
      act({ activity_id: 'a1' }),
      act({ activity_id: 'a2', category: 'strength' }),
      act({ activity_id: 'a3', category: 'running', completion_source: 'self_report' }),
    ];
    expect(matchWorkoutToActivity({ type: 'running' }, mixed)?.activity_id).toBe('a1');
  });

  it('matches nothing when nothing fits', () => {
    expect(matchWorkoutToActivity({ type: 'swimming' }, [act()])).toBeNull();
    expect(matchWorkoutToActivity({ type: 'running' }, [])).toBeNull();
  });
});

describe('workoutValue', () => {
  it('keeps the real numbers so the session shows what was done', () => {
    expect(workoutValue({ type: 'running', duration_min: 77.4, distance_km: 8.7823 })).toEqual({
      duration_min: 77,
      distance_km: 8.78,
    });
  });

  it('omits what the device did not record rather than storing zeros', () => {
    expect(workoutValue({ type: 'running', duration_min: 30, distance_km: 0 })).toEqual({ duration_min: 30 });
    expect(workoutValue({ type: 'yoga' })).toEqual({});
  });
});
