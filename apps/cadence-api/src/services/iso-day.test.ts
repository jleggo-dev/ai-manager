import { describe, expect, it } from 'vitest';
import { isoDay } from './iso-day.ts';

/**
 * One helper, written because the same three-character mistake (`.slice(0, 10)` on a column the
 * row type calls a string and the driver returns as a Date) silently disabled both of the coach's
 * Apple Health reads in production.
 */
describe('isoDay', () => {
  it('takes the day off a Date, which is what postgres actually returns', () => {
    expect(isoDay(new Date('2026-08-15T10:57:00Z'))).toBe('2026-08-15');
  });

  it('takes the day off an ISO string without re-parsing it', () => {
    expect(isoDay('2026-08-15T10:57:00Z')).toBe('2026-08-15');
  });

  /** Re-parsing a bare day as UTC midnight and re-formatting can roll it back a day west of
   *  Greenwich — the front of the string is already the answer. */
  it('leaves a bare day alone rather than round-tripping it through a timezone', () => {
    expect(isoDay('2026-08-15')).toBe('2026-08-15');
  });

  it('gives back nothing for nothing, instead of "Invalid Date" or a throw', () => {
    expect(isoDay(null)).toBe('');
    expect(isoDay(undefined)).toBe('');
    expect(isoDay('')).toBe('');
    expect(isoDay('not a date')).toBe('');
    expect(isoDay(new Date('nonsense'))).toBe('');
  });

  it('handles a non-ISO but parseable string', () => {
    expect(isoDay('Sat, 15 Aug 2026 10:57:00 GMT')).toBe('2026-08-15');
  });
});
