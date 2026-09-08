import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getWeather, type WeatherNow } from '../../lib/api.ts';
import { AMBIENT_STALE_MS, queryKeys, useForecast } from '../../lib/query/index.ts';
import { daySkies, type SkyCategory, type SkyDay } from './daySky.ts';

/**
 * The trail's skies, from the two ambient reads the header already makes — no request of its own.
 *
 * The current reading lives in the cache under `queryKeys.weather` because `useTodayHeader` puts
 * it there (`fetchWeatherCached`), and the forecast follows it (`prefetchForecast`) the moment a
 * sky comes back. This hook only WATCHES those entries: the weather observer is `enabled: false`,
 * so it never fetches and never races the header's own imperative refresh flow (a saved location
 * drops the entry first, and re-reads at the new coordinates) — it just re-renders when the
 * header's answer lands. The forecast subscription mirrors the header's exactly (`useForecast`,
 * gated on a sky being available), so the two are always the same request, deduplicated by key.
 */
export function useDaySkies(days: readonly SkyDay[] | undefined): Record<string, SkyCategory> {
  const { data: weather } = useQuery<WeatherNow>({
    queryKey: queryKeys.weather.all,
    queryFn: getWeather,
    staleTime: AMBIENT_STALE_MS,
    enabled: false,
  });
  const forecast = useForecast(weather?.available === true);
  const week = days ?? NO_DAYS;
  return useMemo(() => daySkies(week, weather, forecast), [week, weather, forecast]);
}

/** A stable "no plan yet", so the memo does not churn before the week lands. */
const NO_DAYS: readonly SkyDay[] = [];
