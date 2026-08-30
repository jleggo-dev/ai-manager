import { useQuery } from '@tanstack/react-query';
import { getRecaps, type RecapListResult } from '../api.ts';
import { queryKeys } from './keys.ts';

/**
 * The `recap_rail` widget's binding query (Progress Engine W2-1). Fixed default `limit` — the
 * rail shows recent weeks regardless of the page's window control, since a recap is inherently a
 * weekly artifact rather than something re-sliced by 'week' | 'month' | 'all'.
 */
export function useRecaps(limit = 8) {
  return useQuery<RecapListResult>({ queryKey: queryKeys.recaps.scoped(limit), queryFn: () => getRecaps(limit) });
}
