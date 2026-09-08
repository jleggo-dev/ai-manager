/**
 * The week clock (0058) — the one decision that fixes "I still have never been prompted for a
 * weekly check-in" (owner, 2026-09-07). Every ordinary commit refreshes `generated_at`, so it can
 * never be the clock; `week_started_at` is carried forward by a commit and reset only by the two
 * check-in exits. Table tests: positives (carry / reset) AND the near-misses (no predecessor, a
 * pre-migration row with the column null, a Date where a string was promised).
 */
import { describe, it, expect } from 'vitest';
import { carriedWeekStart, weekStartIso, weekStartMs, weekStartedAt } from './week-clock.ts';

const GENERATED = '2026-08-05T09:00:00.000Z';
const WEEK_START = '2026-08-01T12:00:00.000Z';

describe('weekStartedAt — which column is the clock', () => {
  it.each([
    ['both set → week_started_at wins', { generated_at: GENERATED, week_started_at: WEEK_START }, WEEK_START],
    ['null (pre-0058 row) → generated_at', { generated_at: GENERATED, week_started_at: null }, GENERATED],
    ['absent (partial object) → generated_at', { generated_at: GENERATED }, GENERATED],
  ])('%s', (_label, plan, want) => {
    expect(weekStartedAt(plan)).toBe(want);
  });

  it('weekStartMs / weekStartIso read the same clock, and accept a Date where a string was promised', () => {
    const asDate = { generated_at: GENERATED, week_started_at: new Date(WEEK_START) as unknown as string };
    expect(weekStartMs(asDate)).toBe(Date.parse(WEEK_START));
    expect(weekStartIso(asDate)).toBe('2026-08-01');
    expect(weekStartIso({ generated_at: GENERATED })).toBe('2026-08-05');
  });
});

describe('carriedWeekStart — what the NEW version inherits', () => {
  it.each([
    // [label, old plan, startsNewWeek, want]
    [
      'ordinary commit carries the clock forward',
      { generated_at: GENERATED, week_started_at: WEEK_START },
      false,
      WEEK_START,
    ],
    [
      'ordinary commit on a pre-0058 predecessor carries its generated_at',
      { generated_at: GENERATED, week_started_at: null },
      false,
      GENERATED,
    ],
    [
      'a check-in exit starts a new week (null → insertPlan writes now())',
      { generated_at: GENERATED, week_started_at: WEEK_START },
      true,
      null,
    ],
    ['a first-ever plan (no predecessor) starts its own week', null, false, null],
    ['a first-ever plan asked to start a new week — still null, no crash', null, true, null],
  ])('%s', (_label, old, startsNewWeek, want) => {
    expect(carriedWeekStart(old, startsNewWeek)).toBe(want);
  });

  it('normalizes a Date-typed predecessor clock to an ISO string the insert can bind', () => {
    const old = { generated_at: GENERATED, week_started_at: new Date(WEEK_START) as unknown as string };
    expect(carriedWeekStart(old, false)).toBe(WEEK_START);
  });
});
