/**
 * This regex used to live twice — `notify/local-plan.ts` and `occurrence/format.ts` — each with a
 * comment warning the two copies must never disagree. Pinning the canonical behaviour here is what
 * makes that warning obsolete: there is only one copy left to get right.
 */
import { describe, it, expect } from 'vitest';
import { isWeeklyCheckinTitle } from './occurrence-titles.ts';

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
