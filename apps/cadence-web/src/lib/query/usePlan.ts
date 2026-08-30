import { useQuery, type QueryClient } from '@tanstack/react-query';
import { getPlan, type PlanViewData } from '../api.ts';
import { localTodayIso, queryKeys } from './keys.ts';

/**
 * `getPlan()` answers `null` for "could not load" — never for "no plan" (lib/api/plan.ts). For
 * the cache that distinction must become a THROW: a thrown queryFn keeps the last good plan on
 * screen through a blip and lets the client's `retry: 1` absorb the transient case, where a
 * cached `null` would replace a real week with the typing dots — the same failure-dressed-as-data
 * shape the 2026-08-19 fix removed from the routing layer.
 */
async function fetchPlanOrThrow(): Promise<PlanViewData> {
  const p = await getPlan();
  if (!p) throw new Error('plan load failed');
  return p;
}

/**
 * The shared `/plan` query (PERF-01). One fetch feeds the app-open gate and every PlanView mount:
 * a tab return inside `staleTime` paints from cache with no network at all, a later one paints
 * from cache instantly and revalidates in the background. The typing dots remain only for the one
 * true first load of a session — GET /plan is a deterministic DB read, and a deterministic screen
 * should never sit behind a thinking animation twice.
 */
export function usePlan() {
  return useQuery<PlanViewData>({ queryKey: queryKeys.plan.all, queryFn: fetchPlanOrThrow });
}

/**
 * The app-open gate fetch, THROUGH the cache. Routing (App.tsx) and PlanView's first paint used
 * to be two sequential `/plan` round trips — the gate resolved, MainTabs mounted, and PlanView
 * refetched the exact plan the gate had just thrown away. Fetching into the cache makes the
 * gate's answer the plan PlanView paints from. Rejects only after the client's built-in retry
 * (two attempts total) — the caller owns the error screen, exactly as before.
 */
export function fetchPlanIntoCache(queryClient: QueryClient): Promise<PlanViewData> {
  return queryClient.fetchQuery({ queryKey: queryKeys.plan.all, queryFn: fetchPlanOrThrow });
}

/** Optimistic local edit of the cached plan (e.g. clearing a proposal the user just answered). */
export function setPlanData(
  queryClient: QueryClient,
  updater: (d: PlanViewData | undefined) => PlanViewData | undefined,
): void {
  queryClient.setQueryData<PlanViewData>(queryKeys.plan.all, updater);
}

/**
 * A snapshotted plan, made safe to paint on the day it is actually being painted on.
 *
 * `/plan` computes `isToday` server-side, so a week cached yesterday says TODAY over yesterday's
 * node — and the trail scrolls to it, labels it, and hangs the food strip off it. Left alone that
 * is a *wrong fact* on screen for as long as the revalidate takes, which is the one thing the
 * skeleton rule exists to prevent ("a skeleton draws shapes, never numbers"). Re-deriving the flag
 * from the day's own `date` costs nothing and makes the stale copy honest.
 *
 * Null when today is not in the cached week at all — a plan that far past is not a stale paint,
 * it is a different week, and PlanView's own skeleton is the truthful screen for the moment it
 * takes to fetch the real one. Routing survives that refusal separately (boot-cache's `stage`).
 */
export function revivePlanSnapshot(data: unknown): PlanViewData | null {
  const plan = data as PlanViewData | undefined;
  if (!plan || !Array.isArray(plan.week)) return null;
  const today = localTodayIso();
  if (!plan.week.some((d) => d.date === today)) return null;
  return { ...plan, week: plan.week.map((d) => ({ ...d, isToday: d.date === today })) };
}

/** Is there a plan on screen already? The app-open gate blanks to a skeleton only when there is not. */
export function hasCachedPlan(queryClient: QueryClient): boolean {
  return queryClient.getQueryData(queryKeys.plan.all) !== undefined;
}
