import { useQuery, type QueryClient } from '@tanstack/react-query';
import { getDailyCheckinStatus, getWeather, type WeatherNow } from '../api.ts';
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
