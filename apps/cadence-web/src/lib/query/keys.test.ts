import { QueryClient } from '@tanstack/react-query';
import { invalidateNutritionDay } from './useNutritionDay.ts';
import { localTodayIso, nutritionDayKeyDate, queryKeys } from './keys.ts';

describe('nutritionDay query keys', () => {
  it('builds hierarchical keys so all dates share a prefix', () => {
    expect(queryKeys.nutritionDay.all).toEqual(['nutritionDay']);
    expect(queryKeys.nutritionDay.day('2026-07-20')).toEqual(['nutritionDay', '2026-07-20']);
  });

  it('normalizes omitted date to local today ISO', () => {
    const fixed = new Date(2026, 6, 20, 15, 30, 0); // local Jul 20 2026
    expect(localTodayIso(fixed)).toBe('2026-07-20');
    expect(nutritionDayKeyDate(undefined, fixed)).toBe('2026-07-20');
    expect(nutritionDayKeyDate('2026-07-19', fixed)).toBe('2026-07-19');
  });
});

describe('invalidateNutritionDay', () => {
  it('marks every nutritionDay cache entry stale (all dates)', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(queryKeys.nutritionDay.day('2026-07-20'), { date: '2026-07-20', meals: [] });
    client.setQueryData(queryKeys.nutritionDay.day('2026-07-19'), { date: '2026-07-19', meals: [] });

    expect(client.getQueryState(queryKeys.nutritionDay.day('2026-07-20'))?.isInvalidated).toBe(false);
    expect(client.getQueryState(queryKeys.nutritionDay.day('2026-07-19'))?.isInvalidated).toBe(false);

    await invalidateNutritionDay(client);

    expect(client.getQueryState(queryKeys.nutritionDay.day('2026-07-20'))?.isInvalidated).toBe(true);
    expect(client.getQueryState(queryKeys.nutritionDay.day('2026-07-19'))?.isInvalidated).toBe(true);
  });
});
