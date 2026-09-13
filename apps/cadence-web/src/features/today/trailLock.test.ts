/**
 * The wall's two rules (trailLock.ts): where the check-in card stands, and which days are locked.
 * A router that decides behaviour gets a table of positives AND near-misses (CLAUDE.md) — the
 * near-misses that matter most here are `ends_on` itself (the due date, which must stay open),
 * today (never locked however late the check-in is), and a week built early (open through
 * `built_through`, while the card still stands on the check-in's own day).
 */
import { describe, it, expect } from 'vitest';
import { isLockedDay, lockedFromDate, wallDate } from './trailLock.ts';

const DUE = { ends_on: '2026-09-07', checkin_due: true };
const RUNNING = { ends_on: '2026-09-07', checkin_due: false };

describe('wallDate — where the check-in card stands', () => {
  it.each([
    // [label, weekState, today, want]
    ['due, today IS ends_on → the day after', DUE, '2026-09-07', '2026-09-08'],
    ['due, today before ends_on (zone skew) → the day after ends_on', DUE, '2026-09-06', '2026-09-08'],
    ['due and late: today past ends_on → the day after TODAY, never today', DUE, '2026-09-10', '2026-09-11'],
    ['due, no today known → the day after ends_on', DUE, undefined, '2026-09-08'],
    ['due, today unparseable → the day after ends_on', DUE, 'today', '2026-09-08'],
    ['month boundary rolls over', { ends_on: '2026-09-30', checkin_due: true }, '2026-09-30', '2026-10-01'],
    // Mid-week (owner, 2026-09-09): the card stands at the week's end before the check-in is due too.
    ['not due, mid-week → still the day after ends_on', RUNNING, '2026-09-03', '2026-09-08'],
    // A built week does not move the CARD — the check-in still lands on its own day.
    [
      'built past the check-in → the card stays on the check-in',
      { ...RUNNING, built_through: '2026-09-14' },
      '2026-09-03',
      '2026-09-08',
    ],
    ['no weekState (no plan) → nothing', null, '2026-09-07', null],
    ['undefined weekState (older server) → nothing', undefined, '2026-09-07', null],
    ['ends_on unparseable → fails OPEN', { ends_on: 'soon', checkin_due: true }, '2026-09-07', null],
    ['ends_on empty → fails OPEN', { ends_on: '', checkin_due: true }, '2026-09-07', null],
  ])('%s', (_label, weekState, today, want) => {
    expect(wallDate(weekState, today)).toBe(want);
  });
});

describe('lockedFromDate — where the lock starts', () => {
  it.each([
    // [label, weekState, today, want]
    ['nothing built → the wall itself', RUNNING, '2026-09-03', '2026-09-08'],
    [
      'built a week ahead → the day after built_through',
      { ...RUNNING, built_through: '2026-09-14' },
      '2026-09-03',
      '2026-09-15',
    ],
    [
      'built short of the wall → the wall still',
      { ...RUNNING, built_through: '2026-09-05' },
      '2026-09-03',
      '2026-09-08',
    ],
    [
      'built exactly to ends_on → the wall (ends_on is open anyway)',
      { ...RUNNING, built_through: '2026-09-07' },
      '2026-09-03',
      '2026-09-08',
    ],
    [
      'built, and late: the later of today+1 and built+1',
      { ...DUE, built_through: '2026-09-14' },
      '2026-09-20',
      '2026-09-21',
    ],
    ['built_through null → the wall', { ...RUNNING, built_through: null }, '2026-09-03', '2026-09-08'],
    ['built_through unparseable → the wall', { ...RUNNING, built_through: 'next week' }, '2026-09-03', '2026-09-08'],
    ['no weekState → nothing locked', null, '2026-09-07', null],
    [
      'ends_on unparseable → fails OPEN, built or not',
      { ends_on: 'soon', checkin_due: false, built_through: '2026-09-14' },
      '2026-09-07',
      null,
    ],
  ])('%s', (_label, weekState, today, want) => {
    expect(lockedFromDate(weekState, today)).toBe(want);
  });
});

describe('isLockedDay — is this day behind it', () => {
  const FROM = '2026-09-08';
  it.each([
    // [label, date, lockedFrom, locked?]
    ['the first locked day', '2026-09-08', FROM, true],
    ['a day well past it', '2026-09-12', FROM, true],
    ['next month', '2026-10-01', FROM, true],
    ['the day before (ends_on itself, when today == ends_on)', '2026-09-07', FROM, false],
    ['a day in the past', '2026-08-30', FROM, false],
    ['no wall at all', '2026-09-12', null, false],
    ['wall undefined (prop not passed)', '2026-09-12', undefined, false],
    ['an unparseable day is never locked', 'tomorrow', FROM, false],
    ['an unparseable wall locks nothing', '2026-09-12', 'soon', false],
    ['a datetime, not a date, is never locked (the trail only carries dates)', '2026-09-12T00:00:00Z', FROM, false],
  ])('%s', (_label, date, lockedFrom, want) => {
    expect(isLockedDay(date, lockedFrom)).toBe(want);
  });
});
