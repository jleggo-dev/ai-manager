import { describe, expect, it } from 'vitest';
import { minutesOfDay } from './plan-horizon.ts';

/**
 * The rule this guards: never write down a task that already went by.
 *
 * Observed 2026-08-15 — someone finished onboarding at 9am and their brand-new plan opened with a
 * 6:30 meditation and a 6:30 long run, both of which the app would shortly count as missed. Their
 * first morning with a coach began with two failures it had invented for them.
 */
describe('minutesOfDay', () => {
  it('reads a clock time', () => {
    expect(minutesOfDay('06:30')).toBe(390);
    expect(minutesOfDay('00:00')).toBe(0);
    expect(minutesOfDay('23:59')).toBe(1439);
    expect(minutesOfDay('7:05')).toBe(425);
  });

  it('returns null for anything it cannot place, so nothing is skipped on a guess', () => {
    // Words are a real value here ("morning" comes out of synthesis), and a word is not a moment:
    // guessing an hour for it would drop tasks the user could still do.
    expect(minutesOfDay('morning')).toBeNull();
    expect(minutesOfDay('evening')).toBeNull();
    expect(minutesOfDay(undefined)).toBeNull();
    expect(minutesOfDay(null)).toBeNull();
    expect(minutesOfDay('')).toBeNull();
    expect(minutesOfDay('25:00')).toBeNull();
    expect(minutesOfDay('06:75')).toBeNull();
  });

  it('tolerates the whitespace a synthesized plan can carry', () => {
    expect(minutesOfDay(' 18:00 ')).toBe(1080);
  });
});
