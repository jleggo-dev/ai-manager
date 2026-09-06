/**
 * `/progress/repertoire/items` — the list room's own read, through the cache.
 *
 * The room opened on "loading" every single time it was entered, including straight back from an
 * item screen it had just pushed. Cached, it opens on the list it had a moment ago and corrects
 * itself behind the paint.
 *
 * The API's `{ ok: false, fault }` becomes a thrown Error carrying the fault's own words, so the
 * screen still says exactly what it said before — and so a crash is never cached as an empty
 * shelf, which is the distinction `repertoire-list.ts` exists to keep.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getRepertoireListItems, type RepertoireListResult } from '../api/repertoire-list.ts';
import { queryKeys } from './keys.ts';

type RepertoireList = Extract<RepertoireListResult, { ok: true }>;

export function useRepertoireList(goalId: string | null) {
  return useQuery<RepertoireList>({
    queryKey: queryKeys.repertoireList.scoped(goalId),
    queryFn: async () => {
      const res = await getRepertoireListItems(goalId);
      if (!res.ok) throw new Error(res.fault);
      return res;
    },
    staleTime: 60_000,
  });
}

/** After a standing change, a reorder, an add or a delete: re-read every scope of the list. */
export function useRefreshRepertoireList() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ['repertoireList'] });
}
