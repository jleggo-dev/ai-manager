/**
 * A future meal's door opens TODAY's twin (owner, 2026-09-07: "log today's snack?"), never the
 * move-to-today ask a session gets. The twin is found by exact title on today's row — a table,
 * since a title matcher that misses fails silently by opening the wrong sheet.
 */
import type { PlanDay, PlanOccurrence } from '../../../lib/api.ts';
import { todaysTwin } from './holdMenuModel.ts';

const occ = (over: Partial<PlanOccurrence>): PlanOccurrence => ({
  occurrence_id: 'x',
  activity_id: 'a1',
  title: 'Log snack',
  kind: 'system',
  status: 'pending',
  time_of_day: '15:30',
  ...over,
});

const day = (date: string, isToday: boolean, occurrences: PlanOccurrence[]): PlanDay => ({
  date,
  weekday: 'Mon',
  dayNum: 7,
  isToday,
  occurrences,
});

const TODAY = '2026-09-07';

describe('todaysTwin', () => {
  it.each([
    ['the same meal on today', 'Log snack', 'snack-today'],
    ['a different meal is not a twin', 'Log dinner', null],
    ['a near-miss title is not a twin', 'Log snacks', null],
  ])('%s', (_, title, expected) => {
    const week = [
      day('2026-09-07', true, [occ({ occurrence_id: 'snack-today', title: 'Log snack', status: 'done' })]),
      day('2026-09-09', false, [occ({ occurrence_id: 'snack-wed', title })]),
    ];
    expect(todaysTwin(week, TODAY, occ({ occurrence_id: 'snack-wed', title }))?.occurrence_id ?? null).toBe(expected);
  });

  it('with no row for today at all, there is no twin — the plain ask takes over', () => {
    const week = [day('2026-09-09', false, [occ({ occurrence_id: 'snack-wed' })])];
    expect(todaysTwin(week, TODAY, occ({ occurrence_id: 'snack-wed' }))).toBeNull();
  });
});
