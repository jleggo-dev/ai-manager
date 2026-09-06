/**
 * The facts every Settings surface opens on: the review (goals, tools, baseline) and the
 * constraints.
 *
 * Both used to be `useEffect` + `useState`, fetched fresh on every mount and kept nowhere — so
 * Settings painted its rows half-written ("Rename or retire a goal" with no count, "Loading…"
 * where the tools go) and filled them in a round trip later, EVERY time, including the second
 * visit in a minute. Through the cache they behave like the rest of the app: the answer survives
 * the screen, and `boot-cache.ts` carries it across the launch, so the room opens finished and a
 * count only moves when the fact behind it actually moved.
 *
 * One key for the whole review, shared by the root list and the doors behind it, is also what
 * stops the count and the door disagreeing — the original reason `SettingsRoom` fetched for its
 * children. A door that writes (rename, retire, add a tool) patches this entry, so the row behind
 * it is already right when you come back through.
 */
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { getConstraints, getReview, type ReviewData, type UserConstraint } from '../api.ts';
import { queryKeys } from './keys.ts';

/**
 * Five minutes. Goals, tools and constraints change when a person (or the coach) changes them,
 * and every writer here patches or invalidates — so a refetch inside that window is asking a
 * question whose answer we already wrote.
 */
const SETTINGS_STALE_MS = 5 * 60_000;

/** Goals, equipment and the baseline — the Settings root's counts and both doors behind them. */
export function useReview() {
  return useQuery<ReviewData>({ queryKey: queryKeys.review.all, queryFn: getReview, staleTime: SETTINGS_STALE_MS });
}

/** "What we work around", read-only in the room. `getConstraints` floors to `[]` and never throws. */
export function useConstraints() {
  return useQuery<UserConstraint[]>({
    queryKey: queryKeys.constraints.all,
    queryFn: getConstraints,
    staleTime: SETTINGS_STALE_MS,
  });
}

/**
 * Write a settled review back after a door has changed one thing in it — a renamed goal, a tool
 * added or removed. A no-op when nothing is cached yet: there is no screen to keep honest, and
 * the next read fetches the server's own version anyway.
 */
export function useUpdateReview() {
  const queryClient = useQueryClient();
  return (patch: (review: ReviewData) => ReviewData) =>
    queryClient.setQueryData<ReviewData>(queryKeys.review.all, (prev) => (prev ? patch(prev) : prev));
}

/** After a write we can't describe locally (the coach edited constraints, an import landed). */
export function useInvalidateReview() {
  const queryClient = useQueryClient();
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.review.all }),
      queryClient.invalidateQueries({ queryKey: queryKeys.constraints.all }),
    ]);
}

/**
 * Fetch both in the background once the session is up, so the FIRST visit to Settings on a device
 * that has no snapshot yet is already finished too — the boot paint covers every launch after the
 * first, and this covers the first. Fire-and-forget by design: it never blocks a screen, and a
 * failure just leaves Settings fetching on open exactly as it did before.
 */
export function prefetchSettingsFacts(queryClient: QueryClient): Promise<unknown> {
  return Promise.all([
    queryClient.prefetchQuery({ queryKey: queryKeys.review.all, queryFn: getReview, staleTime: SETTINGS_STALE_MS }),
    queryClient.prefetchQuery({
      queryKey: queryKeys.constraints.all,
      queryFn: getConstraints,
      staleTime: SETTINGS_STALE_MS,
    }),
  ]).catch(() => undefined);
}
