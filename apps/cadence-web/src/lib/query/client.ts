import { QueryClient } from '@tanstack/react-query';

/**
 * Cadence-web QueryClient defaults (CROSS-03 nutrition-day pilot).
 *
 * Choices (intentionally not aggressive):
 * - `staleTime: 30_000` — Today / Settings / Occurrence sheets share one `/nutrition/day`
 *   fetch within a short window instead of triplicating on mount.
 * - `refetchOnWindowFocus: false` — tab focus is frequent on mobile; refetching nutrition on
 *   every focus would spike API load without user-visible benefit for this surface.
 * - `retry: 1` — one transient blip retry; avoid hammering a failing endpoint.
 * - Mutations (meal log, confirm, weigh-in, macro targets) explicitly invalidate
 *   `queryKeys.nutritionDay` so caches stay correct without relying on focus refetch.
 */
export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        retry: 1,
      },
    },
  });
}
