import { describe, it, expect } from 'vitest';
import type { DailyCheckinRow } from '../repos/coach-moments.ts';
import { resolveFeltWeeks } from './progress-felt-weeks.ts';

// 2026-08-31 is a Monday — the current week starts today, and the three before are
// Aug 10, Aug 17, Aug 24.
const TODAY = '2026-08-31';

function checkin(date: string, mood: number | null): DailyCheckinRow {
  return { date, mood: mood as DailyCheckinRow['mood'], adjustment: null, dismissed_at: null };
}

describe('resolveFeltWeeks', () => {
  it('omits with evidence when no week has a mood noted', () => {
    expect(resolveFeltWeeks([], TODAY)).toEqual({
      id: 'felt_week',
      kind: 'felt_week',
      reason: 'no daily check-in moods in the last four weeks',
    });
    // Rows without a mood (dismissed, answered without one) do not count as read days.
    expect(resolveFeltWeeks([checkin('2026-08-25', null)], TODAY)).toMatchObject({ kind: 'felt_week' });
  });

  it('averages each Monday-start week and leaves an unnoted week null — never zero', () => {
    const rows = [
      // Week of Aug 10: two days read.
      checkin('2026-08-11', 2),
      checkin('2026-08-13', 3),
      // Week of Aug 17: nothing — stays null.
      // Week of Aug 24: three days read, one dismissed day that must not drag the mean.
      checkin('2026-08-24', 4),
      checkin('2026-08-26', 5),
      checkin('2026-08-28', 3),
      checkin('2026-08-29', null),
      // Week of Aug 31 (today): one day read.
      checkin('2026-08-31', 4),
    ];
    expect(resolveFeltWeeks(rows, TODAY)).toEqual({
      weeks: [
        { label: 'Aug 10', value: 2.5, days: 2 },
        { label: 'Aug 17', value: null, days: 0 },
        { label: 'Aug 24', value: 4, days: 3 },
        { label: 'Aug 31', value: 4, days: 1 },
      ],
    });
  });

  it('ignores moods outside the four-week window', () => {
    const rows = [checkin('2026-08-09', 1), checkin('2026-08-12', 4)];
    const result = resolveFeltWeeks(rows, TODAY);
    if (!('weeks' in result)) throw new Error('expected a payload');
    // Aug 9 is the Sunday before the window opens; only Aug 12 lands.
    expect(result.weeks.map((w) => w.days)).toEqual([1, 0, 0, 0]);
    expect(result.weeks[0]).toEqual({ label: 'Aug 10', value: 4, days: 1 });
  });
});
