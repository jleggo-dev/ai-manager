import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { getNutritionDay, type NutritionDayData } from '../api.ts';
import { nutritionDayKeyDate, queryKeys } from './keys.ts';

/** Invalidate every nutrition-day cache entry (all dates). Prefer after targets / weigh-in. */
export function invalidateNutritionDay(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: queryKeys.nutritionDay.all });
}

/**
 * Shared `/nutrition/day` query. Omit `date` to use the local calendar today so TodayDashboard
 * and SettingsSheet hit the same key as Occurrence meal logs for that day.
 */
/** How soon a day that could not be read is asked for again, for as long as something is showing it. */
export const RETRY_FAILED_READ_MS = 10_000;

export function useNutritionDay(date?: string) {
  const day = nutritionDayKeyDate(date);
  return useQuery<NutritionDayData>({
    queryKey: queryKeys.nutritionDay.day(day),
    // A refused read is a failure, not an answer. Returned as null it replaced the day already
    // on screen, and the meal drawer could draw "0 SO FAR" over a day with breakfast in it
    // (owner, 2026-11-04). Thrown, the last good day stays put while the read is tried again.
    queryFn: async () => {
      const read = await getNutritionDay(day);
      if (!read) throw new Error('the day could not be read');
      return read;
    },
    // A surface left open would otherwise sit on the failure until something else asked again.
    refetchInterval: (query) => (query.state.status === 'error' ? RETRY_FAILED_READ_MS : false),
  });
}

/** Hook helper — invalidate all nutrition-day queries from a component/mutation path. */
export function useInvalidateNutritionDay() {
  const queryClient = useQueryClient();
  return () => invalidateNutritionDay(queryClient);
}
