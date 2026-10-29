import { useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { getUsualAtSlot, type MealKind, type UsualAtSlot } from '../../lib/api.ts';
import { queryKeys } from '../../lib/query/keys.ts';

/**
 * One page of the shelf. The list is everything ever logged at this slot, newest first, and
 * scrolls without end (owner, 2026-10-29): the shelf asks for the next page as its bottom comes
 * into view, so the whole history is never loaded at once.
 */
export const USUAL_PAGE_SIZE = 30;

export interface UsualShelf {
  items: UsualAtSlot[];
  hasMore: boolean;
  /** Ask for the next page. Safe to call repeatedly — a second call while one is loading is a no-op. */
  loadMore: () => void;
}

/**
 * What they have AT this slot, newest first. Empty is the honest answer for a new user and for a
 * slot they have never logged. Through the query cache (persisted) so the list paints from last
 * launch's snapshot; the fetch throws on failure, so a blip is never cached as an empty shelf.
 */
export function useUsualAtSlot(meal: MealKind): UsualShelf {
  const q = useInfiniteQuery({
    queryKey: queryKeys.usualAtSlot.paged(meal),
    queryFn: ({ pageParam }) => getUsualAtSlot(meal, USUAL_PAGE_SIZE, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
  });
  const { data, hasNextPage, isFetchingNextPage, fetchNextPage } = q;
  // Stable while nothing changes, so the shelves (a useMemo on this) do not rebuild every render.
  return useMemo(
    () => ({
      items: data?.pages.flatMap((p) => p.items) ?? [],
      hasMore: !!hasNextPage,
      loadMore: () => {
        if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
      },
    }),
    [data, hasNextPage, isFetchingNextPage, fetchNextPage],
  );
}
