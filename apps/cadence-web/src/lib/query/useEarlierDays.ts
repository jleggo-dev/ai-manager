import { useQueries } from '@tanstack/react-query';
import { getEarlierDays, type PlanDay } from '../api.ts';
import { queryKeys } from './keys.ts';

/** The most weeks the trail will scroll back — the server's own cap, mirrored (plan-earlier.ts). */
export const MAX_EARLIER_WEEKS = 8;

/**
 * The weeks before today, oldest first, for the trail to prepend.
 *
 * One query per week rather than one growing query: tapping "the week before" a second time
 * must not refetch the week already on screen, and a log on a past day invalidates under the
 * `plan` prefix like everything else, so a corrected day repaints without dropping the rest.
 * `days` is only what has actually arrived, in calendar order — a week still loading leaves a
 * gap the button copy accounts for, never an empty sky drawn as fact.
 */
export function useEarlierDays(weeks: number): { days: PlanDay[]; loading: boolean; failed: boolean } {
  const results = useQueries({
    queries: Array.from({ length: Math.max(0, Math.min(MAX_EARLIER_WEEKS, weeks)) }, (_, i) => {
      const n = i + 1;
      return {
        queryKey: queryKeys.planEarlier.weeks(n),
        queryFn: async () => {
          const r = await getEarlierDays(n);
          if (!r) throw new Error('earlier days load failed');
          return r.days;
        },
        staleTime: 60_000,
      };
    }),
  });
  // Query n is the week n back, so the calendar order is the reverse of the query order.
  const days = [...results]
    .reverse()
    .flatMap((r) => r.data ?? [])
    .sort((a, b) => a.date.localeCompare(b.date));
  return {
    days,
    loading: results.some((r) => r.isPending),
    failed: results.some((r) => r.isError),
  };
}
