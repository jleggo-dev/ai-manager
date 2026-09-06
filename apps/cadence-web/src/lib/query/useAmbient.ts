import { useQuery, type QueryClient } from '@tanstack/react-query';
import {
  getDailyCheckinStatus,
  getForecast,
  getHomeLocation,
  getWeather,
  type Forecast,
  type LocationResult,
  type WeatherNow,
} from '../api.ts';
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

/** After a location change the cached sky belongs to the old city — drop it before re-reading.
 *  The forecast goes with it: it describes the same point, and a fortnight for the wrong city is
 *  worse than a moment's spinner. */
export function forgetWeather(queryClient: QueryClient): void {
  queryClient.removeQueries({ queryKey: queryKeys.weather.all });
  queryClient.removeQueries({ queryKey: queryKeys.forecast.all });
}

/**
 * The weather sheet's forecast, read AHEAD of the tap. Fired (not awaited) by the header right
 * after the sky comes back, so by the time anyone opens the sheet the hours and days are already
 * in the cache — the sheet used to open on two actions and no forecast, and a sheet that opens on
 * a spinner is only half a fix. Inside `AMBIENT_STALE_MS` a repeat costs nothing.
 */
export function prefetchForecast(queryClient: QueryClient): Promise<void> {
  return queryClient.prefetchQuery({
    queryKey: queryKeys.forecast.all,
    queryFn: getForecast,
    staleTime: AMBIENT_STALE_MS,
  });
}

/** The same forecast, for the sheet to draw. `undefined` while it is still on its way. */
export function useForecast(enabled: boolean): Forecast | undefined {
  const { data } = useQuery({
    queryKey: queryKeys.forecast.all,
    queryFn: getForecast,
    staleTime: AMBIENT_STALE_MS,
    enabled,
  });
  return data;
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
export function fetchLocationCached(queryClient: QueryClient): Promise<LocationResult> {
  return queryClient.fetchQuery({
    queryKey: queryKeys.location.all,
    queryFn: async () => {
      const fresh = await getHomeLocation();
      if (fresh.available) return fresh;
      return queryClient.getQueryData<LocationResult>(queryKeys.location.all) ?? fresh;
    },
    staleTime: AMBIENT_STALE_MS,
  });
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
