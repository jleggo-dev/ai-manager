/**
 * The wall's one rule (trailLock.ts): which days are locked once the check-in is due. A router
 * that decides behaviour gets a table of positives AND near-misses (CLAUDE.md) — the near-miss
 * that matters most here is `ends_on` itself, which is the due date and must stay open, and
 * today, which is never locked however late the check-in is.
 */
import { describe, it, expect } from 'vitest';
import { isLockedDay, lockedFromDate } from './trailLock.ts';

const DUE = { ends_on: '2026-09-07', checkin_due: true };

describe('lockedFromDate — where the wall stands', () => {
  it.each([
    // [label, weekState, today, want]
    ['due, today IS ends_on → the day after', DUE, '2026-09-07', '2026-09-08'],
    ['due, today before ends_on (zone skew) → the day after ends_on', DUE, '2026-09-06', '2026-09-08'],
    ['due and late: today past ends_on → the day after TODAY, never today', DUE, '2026-09-10', '2026-09-11'],
    ['due, no today known → the day after ends_on', DUE, undefined, '2026-09-08'],
    ['due, today unparseable → the day after ends_on', DUE, 'today', '2026-09-08'],
    ['month boundary rolls over', { ends_on: '2026-09-30', checkin_due: true }, '2026-09-30', '2026-10-01'],
    ['not due → nothing locked', { ends_on: '2026-09-07', checkin_due: false }, '2026-09-07', null],
    ['no weekState (no plan) → nothing locked', null, '2026-09-07', null],
    ['undefined weekState (older server) → nothing locked', undefined, '2026-09-07', null],
    ['due but ends_on unparseable → fails OPEN', { ends_on: 'soon', checkin_due: true }, '2026-09-07', null],
    ['due but ends_on empty → fails OPEN', { ends_on: '', checkin_due: true }, '2026-09-07', null],
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
