import { useQuery } from '@tanstack/react-query';
import { getProgress } from '../api.ts';
import { queryKeys } from './keys.ts';

/** The dashboard shape the API returns — the api fn owns it; infer rather than re-declare. */
type ProgressData = Awaited<ReturnType<typeof getProgress>>;

/**
 * The shared `/progress` query (PERF-01): same contract as usePlan — a tab return paints from
 * cache instantly (revalidating in the background once stale), and the typing dots are reserved
 * for the first load of a session. `getProgress` already throws on a non-OK response, so a blip
 * keeps the last good dashboard on screen instead of blanking it.
 */
export function useProgress() {
  return useQuery<ProgressData>({ queryKey: queryKeys.progress.all, queryFn: getProgress });
}
