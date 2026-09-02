import { describe, it, expect } from 'vitest';
import { asClockUnit, formatClock, minutesToClock } from './clock.ts';

/**
 * The plan said "06:00" and the header said "quiet at 9:00" on the same screen (owner,
 * 2026-09-01). One formatter, one setting, every time label.
 */
describe('formatClock', () => {
  it.each([
    ['06:00', '06:00', '6:00 am'],
    ['6:00', '06:00', '6:00 am'],
    ['00:30', '00:30', '12:30 am'],
    ['12:00', '12:00', '12:00 pm'],
    ['21:00', '21:00', '9:00 pm'],
    ['23:59', '23:59', '11:59 pm'],
  ])('%s → %s (24h) / %s (12h)', (input, h24, h12) => {
    expect(formatClock(input, '24h')).toBe(h24);
    expect(formatClock(input, '12h')).toBe(h12);
  });

  it('leaves word times and nonsense alone', () => {
    expect(formatClock('morning', '12h')).toBe('morning');
    expect(formatClock('after work', '24h')).toBe('after work');
    expect(formatClock('25:00', '12h')).toBe('25:00');
    expect(formatClock(undefined, '12h')).toBe('');
  });
});

describe('minutesToClock', () => {
  it('wraps around midnight in both dialects', () => {
    expect(minutesToClock(1470, '24h')).toBe('00:30');
    expect(minutesToClock(-30, '12h')).toBe('11:30 pm');
  });
});

describe('asClockUnit', () => {
  it('accepts only the two dialects', () => {
    expect(asClockUnit('24h')).toBe('24h');
    expect(asClockUnit('12h')).toBe('12h');
    expect(asClockUnit('kg')).toBeNull();
    expect(asClockUnit(undefined)).toBeNull();
  });
});
