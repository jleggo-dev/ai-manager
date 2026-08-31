import { describe, it, expect } from 'vitest';
import { WORKOUT_ACTIVITIES, WORKOUT_ACTIVITY_NAMES, activityIsTracked, activitySpec } from './workout-activities.ts';
import { inferActivity } from './workout-plan.ts';

/**
 * The catalog is the single source for three consumers: the composer's union and inference, the
 * watch's hand-off decision, and the generated Swift map. What is worth pinning is the part that
 * is invisible when wrong — a session quietly filed as the wrong activity still composes, still
 * schedules, and still looks fine until somebody reads their Health app.
 */
describe('the catalog itself', () => {
  it('names every activity uniquely', () => {
    expect(new Set(WORKOUT_ACTIVITY_NAMES).size).toBe(WORKOUT_ACTIVITY_NAMES.length);
  });

  it('uses HealthKit case names with a lowercased first letter, so the Swift map is mechanical', () => {
    for (const name of WORKOUT_ACTIVITY_NAMES) {
      expect(name[0]).toBe(name[0]?.toLowerCase());
      expect(name).toMatch(/^[a-z][A-Za-z]*$/);
    }
  });

  it('keeps `other` as a fallback nothing can infer its way into', () => {
    expect(activitySpec('other')?.words).toEqual([]);
    expect(inferActivity('something nobody has a word for')).toBe('other');
  });

  it('never gives one cue to two activities', () => {
    const seen = new Map<string, string>();
    for (const activity of WORKOUT_ACTIVITIES) {
      for (const word of activity.words) {
        expect(seen.has(word), `"${word}" claimed by both ${seen.get(word)} and ${activity.name}`).toBe(false);
        seen.set(word, activity.name);
      }
    }
  });

  it('asserts a location only where the activity implies one', () => {
    // "Usually indoors" is not knowledge — WorkoutKit treats location as a real dimension, and
    // guessing makes a garage session illegal for a goal shape it should support.
    for (const name of ['traditionalStrengthTraining', 'highIntensityIntervalTraining', 'coreTraining', 'yoga']) {
      expect(activitySpec(name)?.location, name).toBe('unknown');
    }
    // Pool or open water, erg or boat, is a fact about the session and not about the sport.
    expect(activitySpec('swimming')?.location).toBe('unknown');
    expect(activitySpec('rowing')?.location).toBe('unknown');
    // A machine is a place.
    expect(activitySpec('elliptical')?.location).toBe('indoor');
    // Over ground.
    expect(activitySpec('running')?.location).toBe('outdoor');
  });
});

describe('inferActivity — the defect this vocabulary was built to fix', () => {
  it('recognises the activities that used to compose to `other`', () => {
    // Every one of these was `.other` before 2026-08-30 and reached Apple as an unnamed workout.
    const cases: Array<[string, string]> = [
      ['Reformer pilates', 'pilates'],
      ['Barre class', 'barre'],
      ['Boxing — heavy bag', 'boxing'],
      ['Elliptical intervals', 'elliptical'],
      ['Cardio dance', 'cardioDance'],
      ['Jump rope conditioning', 'jumpRope'],
      ['Tai chi in the park', 'taiChi'],
      ['Downhill skiing', 'downhillSkiing'],
      ['Pickleball with Dana', 'pickleball'],
      ['Bouldering session', 'climbing'],
      ['Kayak on the lake', 'paddleSports'],
      ['Mobility work', 'flexibility'],
    ];
    for (const [text, expected] of cases) {
      expect(inferActivity(text.toLowerCase()), text).toBe(expected);
    }
  });

  it('matches at word boundaries, not anywhere in a word', () => {
    // The shipped bug: "throwing" contains "row", so a med-ball session composed to ROWING.
    expect(inferActivity('throwing drills med ball throws')).not.toBe('rowing');
    expect(inferActivity('throwing drills med ball throws')).toBe('other');
    // And the boundary still lets a prefix through, which is how "run" finds "running".
    expect(inferActivity('easy running')).toBe('running');
    expect(inferActivity('rowing intervals')).toBe('highIntensityIntervalTraining');
  });

  it('lets the longest cue win, so a qualifier is never lost', () => {
    expect(inferActivity('rowing machine pieces')).toBe('rowing');
    expect(inferActivity('cross country ski')).toBe('crossCountrySkiing');
    expect(inferActivity('table tennis')).toBe('tableTennis');
  });
});

describe('activityIsTracked — which face opens it', () => {
  it('tracks a continuous measured effort', () => {
    for (const name of ['running', 'cycling', 'swimming', 'hiking', 'downhillSkiing', 'rowing']) {
      expect(activityIsTracked(name), name).toBe(true);
    }
  });

  it('guides gym and studio work instead', () => {
    // These are where OUR choreography is the value: the interval ring, the set-log's crown.
    for (const name of [
      'traditionalStrengthTraining',
      'highIntensityIntervalTraining',
      'yoga',
      'pilates',
      'coreTraining',
    ]) {
      expect(activityIsTracked(name), name).toBe(false);
    }
  });

  it('does not start a distance tracker for something it cannot classify', () => {
    // A guided session degrades to a timer and a list of names, which is honest. Recording a
    // route and a pace for work that may have neither is not.
    expect(activityIsTracked('other')).toBe(false);
    expect(activityIsTracked('nonsense')).toBe(false);
  });
});
