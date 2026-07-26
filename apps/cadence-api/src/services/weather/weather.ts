/**
 * Deterministic weather engine (§B1) — OpenWeatherMap current + short forecast.
 * Cached by rounded lat/lon + local date. No LLM. Soft-fails when unconfigured.
 */
import { getUser } from '../../repos/users.ts';
import { isWeatherConfigured, owmGeoGet, owmGet, WeatherConfigError, WeatherHttpError } from './weather-http.ts';
import {
  formatWeatherLine,
  mapOwmToSnapshot,
  weatherCacheKey,
  type OwmCurrentPayload,
  type OwmForecastPayload,
  type WeatherSnapshot,
} from './weather-map.ts';

export type { WeatherSnapshot } from './weather-map.ts';
export { formatWeatherLine, isOutdoorActivity, localDateIso, localTimeLabel, weatherCacheKey } from './weather-map.ts';
export { isWeatherConfigured, WeatherConfigError, WeatherHttpError } from './weather-http.ts';

/** In-memory daily bucket cache — process-local; enough for thousands of users with aggressive rounding. */
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
  if (!isWeatherConfigured()) return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const key = weatherCacheKey(lat, lon, timezone);
  const cached = cacheGet(key);
  if (cached) return cached;

  try {
    const snapshot = await fetchOwm(lat, lon);
    if (!snapshot) return null;
    cacheSet(key, snapshot);
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
