/**
 * The forecast AHEAD — the hours and days behind the weather sheet's tabs. Fetched for the place
 * the header draws (where you ARE, home otherwise — A21), cached the way the snapshot is.
 *
 * A sibling of `forecast.ts` rather than an extension of it: that file keeps OWM's 3-hourly slots
 * for the weather_move nudge, is OWM-only by design, and answers a yes/no question about one hour.
 * This one is read by a screen, prefers WeatherKit like the snapshot does, and hands back a series
 * in the shape the sheet draws. The two sharing a fetcher would mean the nudge's producer dragging
 * WeatherKit's signer in behind it.
 *
 * Two tiers, same as `weather.ts`: L1 the process Map, L2 `cadence.weather_cache` under a
 * `forecast:` key, then the provider. Keyed by the same ~11 km cell + local date, so a whole city
 * shares one bill — and the sheet is PRELOADED on every launch, which is exactly when that matters.
 */
import { getUser } from '../../repos/users.ts';
import { getCachedWeather, putCachedWeather } from '../../repos/weather-cache.ts';
import { mapOwmSeries, mapWeatherKitSeries, type ForecastSeries } from './forecast-series.ts';
import { isWeatherConfigured, owmGet, WeatherConfigError, WeatherHttpError } from './weather-http.ts';
import { weatherCacheKey, type OwmForecastPayload } from './weather-map.ts';
import { isWeatherKitConfigured, weatherKitGet, WeatherKitError } from './weatherkit-http.ts';
import type { WeatherKitPayload } from './weatherkit-map.ts';

export type { ForecastDayOut, ForecastHourOut, ForecastSeries } from './forecast-series.ts';

/** An hour, matching the snapshot: a series that moves slower than the current reading does. */
const SOFT_TTL_MS = 60 * 60 * 1000;

/** OWM's free 5-day series is 40 slots of three hours. One call covers every tab the sheet has. */
const OWM_SLOT_COUNT = 40;

const cache = new Map<string, { series: ForecastSeries; expiresAt: number }>();

/** Test seam — clear the process cache. */
export function __clearForecastAheadCacheForTests(): void {
  cache.clear();
}

async function fetchFromProvider(lat: number, lon: number, timezone: string | null | undefined) {
  if (isWeatherKitConfigured()) {
    try {
      const raw = (await weatherKitGet(lat, lon, timezone, [
        'currentWeather',
        'forecastHourly',
        'forecastDaily',
      ])) as WeatherKitPayload;
      const series = mapWeatherKitSeries(raw, timezone);
      if (series) return series;
      console.warn('[forecast-ahead] WeatherKit payload unusable — falling back to OpenWeatherMap');
    } catch (err) {
      const status = err instanceof WeatherKitError ? err.status : 0;
      console.warn(`[forecast-ahead] WeatherKit failed (${status}) — falling back to OpenWeatherMap`);
    }
  }
  if (!isWeatherConfigured()) return null;
  const q = `lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lon))}&units=metric`;
  return mapOwmSeries((await owmGet(`/forecast?${q}&cnt=${OWM_SLOT_COUNT}`)) as OwmForecastPayload, timezone);
}

/**
 * The series for a point. Null when unconfigured, on any provider failure, or when the answer
 * carried nothing usable — the sheet then shows the current reading alone, never a made-up week.
 */
export async function getForecastAheadAt(
  lat: number,
  lon: number,
  timezone?: string | null,
): Promise<ForecastSeries | null> {
  if (!isWeatherConfigured() && !isWeatherKitConfigured()) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const key = `forecast:${weatherCacheKey(lat, lon, timezone)}`;
  const hit = cache.get(key);
  if (hit && Date.now() < hit.expiresAt) return hit.series;

  // Guarded on its own, like the snapshot's L2 read: the repo soft-fails, but nothing here may
  // depend on that — a cache fault costs a provider call, never the request.
  const shared = await getCachedWeather<ForecastSeries>(key).catch(() => null);
  if (shared) {
    cache.set(key, { series: shared, expiresAt: Date.now() + SOFT_TTL_MS });
    return shared;
  }

  try {
    const series = await fetchFromProvider(lat, lon, timezone);
    if (!series) return null;
    cache.set(key, { series, expiresAt: Date.now() + SOFT_TTL_MS });
    void putCachedWeather(key, series, SOFT_TTL_MS);
    return series;
  } catch (err) {
    if (err instanceof WeatherConfigError) return null;
    if (err instanceof WeatherHttpError) console.warn(`[forecast-ahead] HTTP ${err.status}: ${err.message}`);
    else console.warn('[forecast-ahead] fetch failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** A stored point is only forecast-able with real numbers in it (same rule as the snapshot). */
function usablePoint<T extends { lat: number; lon: number }>(loc: T | null | undefined): T | null {
  return loc && Number.isFinite(loc.lat) && Number.isFinite(loc.lon) ? loc : null;
}

/**
 * The forecast where the user IS — the transient position when one is set, home otherwise (A21),
 * which is the point the header's chip already describes. Carries the zone the days were cut on,
 * so the sheet labels them in the same one.
 */
export async function getForecastWhereYouAre(
  userId: string,
): Promise<{ series: ForecastSeries; timezone: string | null } | null> {
  const user = await getUser(userId);
  const loc = usablePoint(user?.current_location) ?? usablePoint(user?.home_location);
  if (!loc) return null;
  const series = await getForecastAheadAt(loc.lat, loc.lon, user?.timezone);
  return series ? { series, timezone: user?.timezone ?? null } : null;
}
