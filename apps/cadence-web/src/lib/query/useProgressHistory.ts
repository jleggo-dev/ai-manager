import { useQuery } from '@tanstack/react-query';
import { getProgressHistory } from '../api.ts';
import { queryKeys } from './keys.ts';

/** The response shape the API returns — the api fn owns it; infer rather than re-declare. */
type ProgressHistory = Awaited<ReturnType<typeof getProgressHistory>>;

/**
 * `GET /progress/history?from&to` (PERF-01 style): cached paint + background revalidate, keyed
 * on the exact [from, to] range so different drill-downs (a week, the whole month) keep separate
 * cache entries instead of overwriting one another. Plumbing only — no caller wires this up yet;
 * integration reads `data.rhythm` for the `rhythm` widget and `data.occurrences`/`check_ins` for
 * the week's day-list drill-down.
 */
export function useProgressHistory(from: string, to: string) {
  return useQuery<ProgressHistory>({
    queryKey: queryKeys.progressHistory.range(from, to),
    queryFn: () => getProgressHistory(from, to),
  });
}
