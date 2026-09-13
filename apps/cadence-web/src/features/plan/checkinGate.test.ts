/**
 * The gate's table (checkinGate.ts): which prompt a tap gets, and when it gets none. Positives
 * and near-misses side by side — the near-misses that matter: an open day before the check-in
 * (never asks), the check-in's own day after "later today" (asks no more that day), a locked day
 * after "later today" (still asks — it is the only door), and day 3 vs day 4 (the wording line).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { gateFor, planDay, readLaterOn, writeLaterOn } from './checkinGate.ts';

const WEEK = { ends_on: '2026-09-13', started_on: '2026-09-06' }; // a Sunday-to-Sunday week

describe('planDay — day N of the plan', () => {
  it.each([
    ['the first day is day 1', '2026-09-06', '2026-09-06', 1],
    ['the third day', '2026-09-06', '2026-09-08', 3],
    ['the check-in day is day 8', '2026-09-06', '2026-09-13', 8],
    ['a start after today never goes below 1', '2026-09-10', '2026-09-06', 1],
    ['no start known → 4, the mid-week wording', undefined, '2026-09-06', 4],
    ['garbage start → 4', 'yesterday', '2026-09-06', 4],
  ])('%s', (_label, startedOn, today, want) => {
    expect(planDay(startedOn, today)).toBe(want);
  });
});

describe('gateFor — which prompt a tap gets', () => {
  it.each([
    // [label, date tapped, locked, today, laterOn, want]
    ['day 1, a locked day → the early ask', '2026-09-15', true, '2026-09-06', null, { variant: 'early', day: 1 }],
    ['day 3, a locked day → still the early ask', '2026-09-15', true, '2026-09-08', null, { variant: 'early', day: 3 }],
    ['day 4, a locked day → the three-way ask', '2026-09-15', true, '2026-09-09', null, { variant: 'midweek', day: 4 }],
    ['day 7, a locked day → the three-way ask', '2026-09-15', true, '2026-09-12', null, { variant: 'midweek', day: 7 }],
    ['an open day before the check-in never asks', '2026-09-09', false, '2026-09-08', null, null],
    [
      'the check-in day, its own activity → the due ask',
      '2026-09-13',
      false,
      '2026-09-13',
      null,
      { variant: 'due', day: 8 },
    ],
    [
      'the check-in day, a built next-week day → the due ask',
      '2026-09-16',
      false,
      '2026-09-13',
      null,
      { variant: 'due', day: 8 },
    ],
    [
      'the check-in day, a locked day → the due ask',
      '2026-09-20',
      true,
      '2026-09-13',
      null,
      { variant: 'due', day: 8 },
    ],
    [
      "the check-in day, yesterday's activity → no ask (it is before the check-in)",
      '2026-09-12',
      false,
      '2026-09-13',
      null,
      null,
    ],
    ['after "later today", an open day is quiet for the day', '2026-09-13', false, '2026-09-13', '2026-09-13', null],
    [
      'after "later today", a locked day still asks — the only door',
      '2026-09-20',
      true,
      '2026-09-13',
      '2026-09-13',
      { variant: 'due', day: 8 },
    ],
    [
      '"later today" from yesterday no longer counts',
      '2026-09-14',
      false,
      '2026-09-14',
      '2026-09-13',
      { variant: 'due', day: 9 },
    ],
    ['late by a week, still the due ask', '2026-09-20', false, '2026-09-20', null, { variant: 'due', day: 15 }],
  ])('%s', (_label, date, locked, todayIso, laterOn, want) => {
    expect(gateFor({ date, locked, todayIso, weekState: WEEK, laterOn })).toEqual(want);
  });

  it('asks nothing without a readable week', () => {
    expect(
      gateFor({ date: '2026-09-15', locked: true, todayIso: '2026-09-06', weekState: null, laterOn: null }),
    ).toBeNull();
    expect(
      gateFor({
        date: '2026-09-15',
        locked: true,
        todayIso: '2026-09-06',
        weekState: { ends_on: 'soon' },
        laterOn: null,
      }),
    ).toBeNull();
    expect(gateFor({ date: '2026-09-15', locked: true, todayIso: 'today', weekState: WEEK, laterOn: null })).toBeNull();
  });

  it('uses the mid-week wording when the start is unknown (older server)', () => {
    expect(
      gateFor({
        date: '2026-09-15',
        locked: true,
        todayIso: '2026-09-06',
        weekState: { ends_on: '2026-09-13' },
        laterOn: null,
      }),
    ).toEqual({ variant: 'midweek', day: 4 });
  });
});

describe('"later today" — remembered for the day, on this device', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('round-trips a day and ignores garbage', () => {
    expect(readLaterOn()).toBeNull();
    writeLaterOn('2026-09-13');
    expect(readLaterOn()).toBe('2026-09-13');
    localStorage.setItem('cadence.checkin-gate.later', 'whenever');
    expect(readLaterOn()).toBeNull();
  });
});
