import { useQuery } from '@tanstack/react-query';
import type { ProgressLayout } from '@cadence/shared';
import { getProgressLayout } from '../api.ts';
import { queryKeys } from './keys.ts';

/**
 * The `/me/progress-layout` query — same shared-cache shape as usePlan/useProgress (PERF-01): a
 * tab return paints from cache instantly while revalidating in the background. Integration (W1-6)
 * wires this into ProgressView to drive section order/kinds from the layout instead of a fixed page.
 */
export function useProgressLayout() {
  return useQuery<ProgressLayout>({ queryKey: queryKeys.progressLayout.all, queryFn: getProgressLayout });
}
