/**
 * Deterministic weather engine (§B1) — OpenWeatherMap current + short forecast.
 * Cached by rounded lat/lon + local date. No LLM. Soft-fails when unconfigured.
 */
import { getUser } from '../../repos/users.ts';
import { getCachedWeather, putCachedWeather, pruneExpiredWeather } from '../../repos/weather-cache.ts';
import { isWeatherConfigured, owmGeoGet, owmGet, WeatherConfigError, WeatherHttpError } from './weather-http.ts';
import {
  formatWeatherLine,
  mapOwmToSnapshot,
  weatherCacheKey,
  type OwmCurrentPayload,
  type OwmForecastPayload,
  type WeatherSnapshot,
} from './weather-map.ts';
import { isWeatherKitConfigured, weatherKitGet, WeatherKitError } from './weatherkit-http.ts';
import { mapWeatherKitToSnapshot, type WeatherKitPayload } from './weatherkit-map.ts';

export type { WeatherSnapshot } from './weather-map.ts';
export {
  formatWeatherLine,
  isOutdoorActivity,
  localDateIso,
  localTimeLabel,
  weatherCacheKey,
  needsAppleAttribution,
  APPLE_WEATHER_ATTRIBUTION_URL,
} from './weather-map.ts';
export { isWeatherConfigured, WeatherConfigError, WeatherHttpError } from './weather-http.ts';
export { isWeatherKitConfigured, WeatherKitError } from './weatherkit-http.ts';

/**
 * L1: in-memory, process-local — free, and saves a DB round trip for repeat hits in one process.
 * L2 is `cadence.weather_cache` (migration 0025), shared across instances and surviving restarts;
 * without it every cold start re-billed the provider. Miss on both → the provider.
 */
const cache = new Map<string, { snapshot: WeatherSnapshot; expiresAt: number }>();

/** Soft TTL within the local-date key (OWM free tier freshness; still one key per day+bucket). */
const SOFT_TTL_MS = 60 * 60 * 1000;

/** Test seam — clear process cache. */
export function __clearWeatherCacheForTests(): void {
  cache.clear();
}

function cacheGet(key: string): WeatherSnapshot | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() > hit.expiresAt) {
    cache.delete(key);
    return null;
  }
  return hit.snapshot;
}

function cacheSet(key: string, snapshot: WeatherSnapshot): void {
  cache.set(key, { snapshot, expiresAt: Date.now() + SOFT_TTL_MS });
}

/**
 * WeatherKit first, OpenWeatherMap as fallback. Rationale is OS consistency: an iOS user's lock
 * screen shows Apple's forecast, so Cadence quoting a different provider reads as wrong even when
 * it isn't. The fallback is not belt-and-braces — WeatherKit legitimately 404s for points it has
 * no data on, and OWM remains the only geocoder either way.
 *
 * Returns null only when BOTH are unusable; the caller treats that as "no weather", which every
 * consumer already tolerates.
 */
async function fetchFromProvider(lat: number, lon: number, timezone?: string | null): Promise<WeatherSnapshot | null> {
  if (isWeatherKitConfigured()) {
    try {
      const snapshot = mapWeatherKitToSnapshot((await weatherKitGet(lat, lon, timezone)) as WeatherKitPayload);
      if (snapshot) return snapshot;
      console.warn('[weather] WeatherKit payload unusable — falling back to OpenWeatherMap');
    } catch (err) {
      const status = err instanceof WeatherKitError ? err.status : 0;
      console.warn(`[weather] WeatherKit failed (${status}) — falling back to OpenWeatherMap`);
    }
  }
  if (!isWeatherConfigured()) return null;
  return fetchOwm(lat, lon);
}

async function fetchOwm(lat: number, lon: number): Promise<WeatherSnapshot | null> {
  const q = `lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lon))}&units=metric`;
  const [currentRaw, forecastRaw] = await Promise.all([
    owmGet(`/weather?${q}`),
    owmGet(`/forecast?${q}&cnt=8`).catch((err) => {
      // Forecast is nice-to-have; current alone is enough for temp/tripwires.
      console.warn('[weather] forecast fetch failed:', err instanceof Error ? err.message : err);
      return null;
    }),
  ]);
  return mapOwmToSnapshot(currentRaw as OwmCurrentPayload, (forecastRaw as OwmForecastPayload | null) ?? null);
}

/**
 * Weather for a lat/lon, cached by rounded coords + local date in `timezone`.
 * Returns null when unconfigured, on HTTP failure, or when the payload can't be mapped.
 */
export async function getWeatherAt(
  lat: number,
  lon: number,
  timezone?: string | null,
): Promise<WeatherSnapshot | null> {
  // Either provider is enough — an OWM-less deployment with WeatherKit configured still has weather.
  if (!isWeatherConfigured() && !isWeatherKitConfigured()) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const key = weatherCacheKey(lat, lon, timezone);
  const cached = cacheGet(key);
  if (cached) return cached;

  // L2: another instance (or this one before a restart) may already have paid for this cell today.
  // Guarded independently of the provider try//catch below: the repo soft-fails internally, but
  // this must not DEPEND on that — `session-generate` awaits getWeatherForUser with no catch, so a
  // throw escaping here would break session generation over a cache problem.
  const shared = await getCachedWeather(key).catch(() => null);
  if (shared) {
    cacheSet(key, shared); // warm L1 so the rest of this process's requests skip the DB too
    return shared;
  }

  try {
    const snapshot = await fetchFromProvider(lat, lon, timezone);
    if (!snapshot) return null;
    cacheSet(key, snapshot);
    // Publish to the shared cache + sweep dead rows. Both soft-fail, and neither blocks the
    // caller's result — a cache outage must cost a provider call, never a failed request.
    void putCachedWeather(key, snapshot, SOFT_TTL_MS).then(pruneExpiredWeather);
    return snapshot;
  } catch (err) {
    if (err instanceof WeatherConfigError) return null;
    if (err instanceof WeatherHttpError) {
      console.warn(`[weather] HTTP ${err.status}: ${err.message}`);
      return null;
    }
    console.warn('[weather] fetch failed:', err instanceof Error ? err.message : err);
    return null;
  }
}

/** Weather at the user's persisted home_location (null when missing/unconfigured). */
export async function getWeatherForUser(userId: string): Promise<WeatherSnapshot | null> {
  const user = await getUser(userId);
  const loc = user?.home_location;
  if (!loc || !Number.isFinite(loc.lat) || !Number.isFinite(loc.lon)) return null;
  return getWeatherAt(loc.lat, loc.lon, user?.timezone);
}

/** Compact facts string for job variables / coach injection; empty when unavailable. */
export async function weatherVarsForUser(userId: string): Promise<{ weather: string; weather_temp_c: string }> {
  const w = await getWeatherForUser(userId);
  if (!w) return { weather: '', weather_temp_c: '' };
  return { weather: formatWeatherLine(w), weather_temp_c: String(Math.round(w.tempC)) };
}

/** City/place name → coarse lat/lon via OWM geocoding (city/timezone fallback path). */
export async function geocodeCity(city: string): Promise<{ lat: number; lon: number; label: string } | null> {
  const q = city.trim();
  if (!q || !isWeatherConfigured()) return null;
  try {
    const raw = await owmGeoGet(`/direct?q=${encodeURIComponent(q)}&limit=1`);
    const first = Array.isArray(raw)
      ? (raw[0] as { lat?: number; lon?: number; name?: string; state?: string; country?: string })
      : null;
    if (!first || typeof first.lat !== 'number' || typeof first.lon !== 'number') return null;
    const parts = [first.name, first.state, first.country].filter(
      (p): p is string => typeof p === 'string' && !!p.trim(),
    );
    return { lat: first.lat, lon: first.lon, label: parts.join(', ') || q };
  } catch (err) {
    console.warn('[weather] geocode failed:', err instanceof Error ? err.message : err);
    return null;
  }
}
