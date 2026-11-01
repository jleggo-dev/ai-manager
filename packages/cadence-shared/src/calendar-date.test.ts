import { describe, it, expect } from 'vitest';
import { isCalendarDate } from './calendar-date.ts';

/**
 * Every validator that used to hold its own `/^\d{4}-\d{2}-\d{2}$/` now asks this. The shape-only
 * check accepted "2026-02-30" at 30+ call sites and the database cast threw on it. The rows are the
 * shapes callers actually receive: a model's tool argument, a query string, a request body.
 */
describe('isCalendarDate', () => {
  it.each([
    ['an ordinary day', '2026-02-28'],
    ['a leap day in a leap year', '2024-02-29'],
    ['a leap day in a year divisible by 400', '2000-02-29'],
    ['the last day of a 31-day month', '2026-12-31'],
    ['the last day of a 30-day month', '2026-04-30'],
    ['the first day of a year', '2027-01-01'],
  ])('positive: %s', (_label, value) => {
    expect(isCalendarDate(value)).toBe(true);
  });

  it.each([
    ['Feb 30 — the shape passes, the day does not exist', '2026-02-30'],
    ['Feb 29 in a common year', '2026-02-29'],
    ['Feb 29 in a century year not divisible by 400', '1900-02-29'],
    ['April 31', '2026-04-31'],
    ['month 13', '2026-13-01'],
    ['month 00', '2026-00-10'],
    ['day 00', '2026-11-00'],
    ['year zero — Postgres has none', '0000-01-01'],
    ['a two-digit year', '26-02-28'],
    ['no padding', '2026-2-8'],
    ['slashes', '2026/02/28'],
    ['a timestamp', '2026-02-28T00:00'],
    ['a leading space', ' 2026-02-28'],
    ['a trailing newline', '2026-02-28\n'],
    ['words', 'next friday'],
    ['empty', ''],
    ['undefined', undefined],
    ['null', null],
    ['a number', 20260228],
    ['a Date', new Date('2026-02-28T00:00:00Z')],
  ])('near-miss: %s', (_label, value) => {
    expect(isCalendarDate(value)).toBe(false);
  });
});
