import { describe, expect, it } from 'vitest';
import { isCalendarDate, normalizeFollowUpId } from './follow-up-input.ts';

/**
 * Two routers, one table each (CLAUDE.md: every router ships with positives AND near-misses).
 * The id normaliser decides which row close_follow_up reaches; the date check decides whether
 * note_follow_up writes at all.
 */
describe('normalizeFollowUpId', () => {
  it.each([
    ['the bare prefix', '3f9a2c1d', '3f9a2c1d'],
    ['in brackets, as her context prints it', '[3f9a2c1d]', '3f9a2c1d'],
    ['upper case', '3F9A2C1D', '3f9a2c1d'],
    ['padded', '  3f9a2c1d ', '3f9a2c1d'],
    ['quoted', '"3f9a2c1d"', '3f9a2c1d'],
    ['with a hash', '#3f9a2c1d', '3f9a2c1d'],
    ['a label in front — the d of "id" is not glued on', 'id: 3f9a2c1d', '3f9a2c1d'],
    ['the item text after it', '[3f9a2c1d] ask about the race entry', '3f9a2c1d'],
    ['the full uuid', '3f9a2c1d-0000-4000-8000-000000000000', '3f9a2c1d-0000-4000-8000-000000000000'],
    ['the full uuid in brackets', '[3f9a2c1d-0000-4000-8000-000000000000]', '3f9a2c1d-0000-4000-8000-000000000000'],
    ['a longer prefix', '3f9a2c1d-00', '3f9a2c1d-00'],
  ])('positive: %s', (_label, raw, want) => {
    expect(normalizeFollowUpId(raw)).toBe(want);
  });

  it.each([
    ['empty', ''],
    ['eight underscores — a LIKE wildcard, not an id', '________'],
    ['percent signs', '%%%%%%%%'],
    ['too short', '3f9a2c1'],
    ['too short in brackets', '[3f9a]'],
    ['a non-hex letter inside', '3f9a2c1g'],
    ['split by a space', '3f9a 2c1d'],
    ['two ids', '3f9a2c1d, 7b2e0f11'],
    ['hyphens only', '--------'],
    ['words with no id', 'the race entry one'],
  ])('near-miss: %s → null', (_label, raw) => {
    expect(normalizeFollowUpId(raw)).toBeNull();
  });
});

describe('isCalendarDate', () => {
  it.each([
    ['an ordinary day', '2026-11-07'],
    ['a leap day in a leap year', '2028-02-29'],
    ['the last day of a 31-day month', '2026-12-31'],
    ['the first day of a year', '2027-01-01'],
  ])('positive: %s', (_label, s) => {
    expect(isCalendarDate(s)).toBe(true);
  });

  it.each([
    ['Feb 30 — the shape passes, the day does not exist', '2026-02-30'],
    ['Feb 29 in a common year', '2026-02-29'],
    ['April 31', '2026-04-31'],
    ['month 13', '2026-13-01'],
    ['month 00', '2026-00-10'],
    ['day 00', '2026-11-00'],
    ['year zero — Postgres has none', '0000-01-01'],
    ['words', 'next friday'],
    ['a timestamp', '2026-11-07T10:00:00Z'],
    ['no padding', '2026-1-7'],
    ['slashes', '2026/11/07'],
    ['empty', ''],
  ])('near-miss: %s', (_label, s) => {
    expect(isCalendarDate(s)).toBe(false);
  });
});
