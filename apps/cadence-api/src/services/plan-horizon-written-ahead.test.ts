/**
 * The calendar is always written past the view (owner, 2026-09-14) — the two pure rules behind
 * it, table-tested: how far (`writtenAheadDays`) and whether it has fallen short
 * (`horizonFallsShort`). A router that decides whether the view writes fails silently: the wrong
 * answer is either a plan with a hole in it or a write on every load.
 */
import { describe, it, expect } from 'vitest';
import { DEFAULT_HORIZON_DAYS, horizonFallsShort, writtenAheadDays } from './plan-horizon.ts';

describe('writtenAheadDays — the view and the week after it', () => {
  it.each([
    ['the ordinary 7-day view → 14', 7, 14],
    ['an extended 14-day week → 21 (its second week, plus one)', 14, 21],
    ['the watch\u2019s 2-day cap → 9 (still a week past what it shows)', 2, 9],
  ])('%s', (_label, view, want) => {
    expect(writtenAheadDays(view)).toBe(want);
    expect(want - view).toBe(DEFAULT_HORIZON_DAYS);
  });
});

describe('horizonFallsShort — is the far week empty?', () => {
  const REACH = '2026-09-28'; // today 2026-09-14 + 14
  const daily = { activity_id: 'a1', schedule: { recurrence: 'FREQ=DAILY' } };
  const weekly = { activity_id: 'a2', schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=MO' } };
  const row = (date: string, activity_id = 'a1') => ({ activity_id, date });

  it.each([
    // [label, rows, activities, short?]
    ['nothing written at all → short', [], [daily], true],
    [
      'written through the day after tomorrow (the confirm-day hole) → short',
      [row('2026-09-14'), row('2026-09-16')],
      [daily],
      true,
    ],
    ['written to the day before the far week → short', [row('2026-09-21')], [daily], true],
    ['a row on the first day of the far week → not short', [row('2026-09-22')], [daily], false],
    ['a row on the reach date itself → not short', [row('2026-09-28')], [daily], false],
    ['a weekly commitment\u2019s one row in the far week → not short', [row('2026-09-28', 'a2')], [weekly], false],
    [
      'a superseded version\u2019s row in the far week → still short (not this plan\u2019s calendar)',
      [row('2026-09-25', 'old')],
      [daily],
      true,
    ],
    [
      'a Date-typed row date (the driver\u2019s shape) → read the same',
      [row(new Date('2026-09-25T00:00:00Z') as unknown as string)],
      [daily],
      false,
    ],
    ['nothing repeats → never short (asking would only ask again)', [], [{ activity_id: 'a1', schedule: {} }], false],
    ['no activities at all → never short', [], [], false],
  ])('%s', (_label, rows, activities, want) => {
    expect(horizonFallsShort(rows, activities, REACH)).toBe(want);
  });
});
