import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { getDailyCheckinStatus, getHomeLocation, getWeather, type LocationResult, type WeatherNow } from '../api.ts';
import { AMBIENT_STALE_MS, queryKeys } from './keys.ts';

/**
 * The Plan tab's two ambient reads, through the cache (PERF-03).
 *
 * Neither of these ever blocked a paint — the header shows its "set location" line without
 * weather, and the check-in renders nothing until it knows it is due. What they did was FIRE, on
 * every single return to the Plan tab, because Plan unmounts on a tab switch and every remount
 * started from nothing. Two of the ~6 requests the 2026-08-20 latency report counted per tab
 * switch were these; inside `AMBIENT_STALE_MS` they now cost no network at all.
 */

/**
 * The trail header's weather, cached. Exposed as a plain fetch rather than a hook because
 * `useTodayHeader` owns an imperative refresh flow (save a new location → re-read the sky at the
 * new coordinates) that a bare `useQuery` cannot express; going through `fetchQuery` keeps that
 * flow exactly as it was while a repeat read inside the window resolves from memory.
 */
export function fetchWeatherCached(queryClient: QueryClient): Promise<WeatherNow> {
  return queryClient.fetchQuery({
    queryKey: queryKeys.weather.all,
    queryFn: getWeather,
    staleTime: AMBIENT_STALE_MS,
  });
}

/** After a location change the cached sky belongs to the old city — drop it before re-reading. */
export function forgetWeather(queryClient: QueryClient): void {
  queryClient.removeQueries({ queryKey: queryKeys.weather.all });
}

/**
 * Where they live, cached — and, through the cache, kept on the device between launches.
 *
 * A plain fetch for the same reason the sky is one: `useTodayHeader` drives an imperative flow
 * (save a place → re-read the place AND the sky at it) that a bare `useQuery` cannot express.
 *
 * `getHomeLocation` soft-fails to `{ available: false }` rather than throwing, and that answer
 * must NOT displace a good one: a blip would otherwise overwrite the cached place with nulls, and
 * the next launch would paint "no location" from disk — the exact bug this is here to close. So a
 * failed read returns the last known answer when there is one.
 */
function locationQueryFn(queryClient: QueryClient) {
  return async (): Promise<LocationResult> => {
    const fresh = await getHomeLocation();
    if (fresh.available) return fresh;
    return queryClient.getQueryData<LocationResult>(queryKeys.location.all) ?? fresh;
  };
}

export function fetchLocationCached(queryClient: QueryClient): Promise<LocationResult> {
  return queryClient.fetchQuery({
    queryKey: queryKeys.location.all,
    queryFn: locationQueryFn(queryClient),
    staleTime: AMBIENT_STALE_MS,
  });
}

/**
 * The same entry as a hook, for the Settings row that shows and edits the place. Same key and the
 * same soft-fail guard as the header's fetch, so the two can never be looking at different places —
 * and so the row is drawn with the rest of Settings rather than a round trip after it.
 */
export function useHomeLocation() {
  const queryClient = useQueryClient();
  return useQuery<LocationResult>({
    queryKey: queryKeys.location.all,
    queryFn: locationQueryFn(queryClient),
    staleTime: AMBIENT_STALE_MS,
  });
}

/** A save or a forget answers with the new place — write it straight in so the header follows. */
export function useSetHomeLocation() {
  const queryClient = useQueryClient();
  return (next: LocationResult) => queryClient.setQueryData<LocationResult>(queryKeys.location.all, next);
}

/** After a save or a forget, the cached place is the old one — drop it before re-reading. */
export function forgetLocation(queryClient: QueryClient): void {
  queryClient.removeQueries({ queryKey: queryKeys.location.all });
}

/**
 * Is the daily check-in due? A once-per-local-day server-side gate, so re-asking on every Plan
 * mount could never have changed the answer.
 *
 * `false` on failure, deliberately: the check-in is the one thing Cadence says uninvited, and a
 * network blip must not be the reason someone gets interrupted. Silence is the safe default here —
 * the opposite of the plan and progress reads, where an absent answer must never look like data.
 */
export function useDailyCheckinDue(): boolean {
  const { data } = useQuery({
    queryKey: queryKeys.dailyCheckin.all,
    queryFn: () => getDailyCheckinStatus().then((s) => s.due),
    staleTime: AMBIENT_STALE_MS,
  });
  return data === true;
}
