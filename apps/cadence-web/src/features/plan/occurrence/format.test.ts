import type { OccurrenceDetail } from '../../../lib/api.ts';
import { downscaleDimensions, isFoodRow, isWeeklyCheckin, mealForNow, ytSearch } from './format.ts';

const detail = (partial: Partial<OccurrenceDetail>): OccurrenceDetail => ({
  occurrence_id: 'o1',
  activity_id: 'a1',
  date: '2026-07-20',
  status: 'pending',
  title: 'Session',
  kind: 'user',
  ...partial,
});

describe('occurrence formatters', () => {
  it('ytSearch builds a search URL and collapses whitespace', () => {
    expect(ytSearch('  goblet   squat  ')).toBe('https://www.youtube.com/results?search_query=goblet%20squat');
  });

  it('mealForNow picks kind from hour-of-day buckets', () => {
    expect(mealForNow(new Date('2026-07-20T08:00:00'))).toBe('breakfast');
    expect(mealForNow(new Date('2026-07-20T12:00:00'))).toBe('lunch');
    expect(mealForNow(new Date('2026-07-20T15:30:00'))).toBe('snack');
    expect(mealForNow(new Date('2026-07-20T19:00:00'))).toBe('dinner');
    expect(mealForNow(new Date('2026-07-20T22:00:00'))).toBe('snack');
  });

  it('downscaleDimensions caps the longest side at 1024 and never shrinks below 1px', () => {
    expect(downscaleDimensions(2048, 1024)).toEqual({ width: 1024, height: 512 });
    expect(downscaleDimensions(800, 600)).toEqual({ width: 800, height: 600 });
    expect(downscaleDimensions(0, 0)).toEqual({ width: 1, height: 1 });
  });

  it('isFoodRow matches system food/meal/nutrition titles only', () => {
    expect(isFoodRow(null)).toBe(false);
    expect(isFoodRow(detail({ kind: 'user', title: 'Meal prep' }))).toBe(false);
    expect(isFoodRow(detail({ kind: 'system', title: 'Log your meals' }))).toBe(true);
    expect(isFoodRow(detail({ kind: 'system', title: 'Food check-in' }))).toBe(true);
    expect(isFoodRow(detail({ kind: 'system', title: 'Nutrition observe' }))).toBe(true);
    expect(isFoodRow(detail({ kind: 'system', title: 'Weigh in' }))).toBe(false);
  });

  /**
   * A23 §2b — the sheet and the server's notification producer must agree about which row is the
   * check-in. Weigh-in rows are excluded explicitly: they are carried INSIDE the recap, and a
   * title like "Weigh-in & check-in" must not open two different panels depending on the matcher.
   */
  it('isWeeklyCheckin matches the check-in row and never the weigh-in', () => {
    expect(isWeeklyCheckin(detail({ kind: 'system', title: 'Weekly check-in' }))).toBe(true);
    expect(isWeeklyCheckin(detail({ kind: 'system', title: 'Weekly checkin' }))).toBe(true);
    expect(isWeeklyCheckin(detail({ kind: 'system', title: 'Your weekly recap' }))).toBe(true);
    expect(isWeeklyCheckin(detail({ kind: 'system', title: 'Weigh in' }))).toBe(false);
    expect(isWeeklyCheckin(detail({ kind: 'system', title: 'Weigh-in & check-in' }))).toBe(false);
    expect(isWeeklyCheckin(detail({ kind: 'user', title: 'Weekly check-in' }))).toBe(false);
    expect(isWeeklyCheckin(detail({ kind: 'system', title: 'Log food' }))).toBe(false);
  });
});
