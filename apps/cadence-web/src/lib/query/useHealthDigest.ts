import { useQuery } from '@tanstack/react-query';
import { getHealthDigest } from '../api.ts';
import { queryKeys } from './keys.ts';

/**
 * The stored `/me/health-digest` (HealthKit summaries) — powers the `weekly_bars` steps widget
 * (W1-6). Same shared-cache shape as useProgressLayout: cached paint, background revalidate.
 * Absent digest means "not read", never zero — the widget renders nothing rather than a flat bar.
 */
export function useHealthDigest() {
  return useQuery({ queryKey: queryKeys.healthDigest.all, queryFn: getHealthDigest });
}
