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
export function useNutritionDay(date?: string) {
  const day = nutritionDayKeyDate(date);
  return useQuery<NutritionDayData | null>({
    queryKey: queryKeys.nutritionDay.day(day),
    queryFn: () => getNutritionDay(day),
  });
}

/** Hook helper — invalidate all nutrition-day queries from a component/mutation path. */
export function useInvalidateNutritionDay() {
  const queryClient = useQueryClient();
  return () => invalidateNutritionDay(queryClient);
}
