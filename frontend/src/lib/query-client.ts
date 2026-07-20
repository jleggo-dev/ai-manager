/**
 * TanStack Query client — CROSS-03 (AI Admin half).
 *
 * Monorepo convention (AI Admin `frontend/` + Cadence `apps/cadence-web`):
 * - Prefer query-key factories (`lib/query-keys.ts`) over ad-hoc string keys.
 * - Invalidate the relevant key(s) after every successful mutation — do not rely on
 *   refetch-on-focus for correctness.
 * - Keep pilots narrow: one shared list/resource per PR until the pattern is familiar.
 *
 * Defaults below are the shared baseline Cadence should mirror for its nutrition-day
 * pilot unless a surface has a documented reason to diverge.
 */
import { QueryClient } from '@tanstack/react-query';

/** 30s — skip refetch when navigating between pages that share a query within this window. */
export const QUERY_STALE_TIME_MS = 30_000;

/** Default TanStack gcTime; unused cache entries stay briefly for back-navigation. */
export const QUERY_GC_TIME_MS = 5 * 60_000;

export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: QUERY_STALE_TIME_MS,
        gcTime: QUERY_GC_TIME_MS,
        retry: 1,
        // Admin/coach UIs: mutations invalidate explicitly; avoid surprise focus refetches.
        refetchOnWindowFocus: false,
      },
    },
  });
}
