/**
 * This regex used to live twice — `notify/local-plan.ts` and `occurrence/format.ts` — each with a
 * comment warning the two copies must never disagree. Pinning the canonical behaviour here is what
 * makes that warning obsolete: there is only one copy left to get right.
 */
import { describe, it, expect } from 'vitest';
import { isWeeklyCheckinTitle, isWeighInTitle } from './occurrence-titles.ts';

/**
 * The scale sheet opened over "Weighted hill intervals" (owner, 2026-09-01): the matcher was
 * `/weigh/i`, and "weighted" contains it. Every title here is one the planner or the coach has
 * actually written, so this table is what "tap every button" means for this router — a new
 * activity title that could be mistaken for a weigh-in gets added here BEFORE it ships.
 */
describe('isWeighInTitle', () => {
  it.each([
    'Weigh-in',
    'Weekly weigh-in',
    'Weigh in',
    'Morning weigh in',
    'Weigh yourself',
    'Weighing day',
    'WEIGH-IN',
  ])('matches %s', (title) => {
    expect(isWeighInTitle(title)).toBe(true);
  });

  it.each([
    'Weighted hill intervals (vest or sandbag) + grip finisher',
    'Weighted vest walk',
    'Weights',
    'Weight training',
    'Body weight squats',
    'Bodyweight circuit',
    'Log breakfast',
    'Easy run',
  ])('does not match %s', (title) => {
    expect(isWeighInTitle(title)).toBe(false);
  });
});

describe('isWeeklyCheckinTitle', () => {
  it.each(['Weekly check-in', 'Weekly checkin', 'Check-In', 'Your monthly recap', 'RECAP'])('matches %s', (title) => {
    expect(isWeeklyCheckinTitle(title)).toBe(true);
  });

  it.each(['Easy run', 'Log breakfast', 'Weigh-in', 'Morning practice'])('does not match %s', (title) => {
    expect(isWeeklyCheckinTitle(title)).toBe(false);
  });

  /**
   * The one case the two prior copies actually disagreed on: the server's regex alone would have
   * matched a title carrying both "weigh" and "check-in"/"recap"; the web version already excluded
   * it. This pins the web's (stricter, correct) behaviour as canonical.
   */
  it('excludes a title that names both the weigh-in and the check-in', () => {
    expect(isWeeklyCheckinTitle('Weekly weigh-in & check-in')).toBe(false);
  });
});
