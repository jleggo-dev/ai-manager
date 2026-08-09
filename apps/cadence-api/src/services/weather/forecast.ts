/**
 * Short-range forecast SLOTS — OpenWeatherMap's 3-hourly series, fetched and kept as a series.
 *
 * `getWeatherAt` deliberately collapses the forecast into one snapshot (a max probability of
 * precipitation) because everything that consumed it wanted "is it going to be wet today?". The
 * weather_move nudge needs something the snapshot cannot answer: *is it wet at seven tomorrow, and
 * is there a drier hour to move to?* That is a question about slots, so this keeps the slots.
 *
 * WeatherKit has no equivalent path here yet, so a deployment with only WeatherKit configured gets
 * an empty list and the nudge never fires. That is the correct degradation: the alternative is a
 * notification asserting "dry and 18 degrees at lunch" on the strength of nothing.
 */
import { owmGet, isWeatherConfigured, WeatherConfigError, WeatherHttpError } from './weather-http.ts';
import { roundCoord, type OwmForecastPayload } from './weather-map.ts';
import { mapForecastSlots, type ForecastSlot } from './forecast-slots.ts';

export type { ForecastSlot } from './forecast-slots.ts';

/** 16 × 3 hours = two days. One call covers tomorrow's session plus every slot it could move to. */
const SLOT_COUNT = 16;

/** Cached per rounded cell for an hour: a tick with many candidates in one city bills once. */
const TTL_MS = 60 * 60 * 1000;
const cache = new Map<string, { slots: ForecastSlot[]; expiresAt: number }>();

/** Test seam — clear the process cache. */
export function __clearForecastCacheForTests(): void {
  cache.clear();
}

/**
 * Forecast slots for a point. Returns [] on any failure — unconfigured, HTTP error, unusable
 * payload. Never throws: the caller is a cron-driven producer, and a weather outage must cost one
 * notification rather than the whole tick.
 */
export async function getForecastSlots(lat: number, lon: number): Promise<ForecastSlot[]> {
  if (!isWeatherConfigured()) return [];
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return [];

  const key = `${roundCoord(lat)},${roundCoord(lon)}`;
  const hit = cache.get(key);
  if (hit && Date.now() < hit.expiresAt) return hit.slots;

  try {
    const q = `lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lon))}&units=metric`;
    const slots = mapForecastSlots((await owmGet(`/forecast?${q}&cnt=${SLOT_COUNT}`)) as OwmForecastPayload);
    cache.set(key, { slots, expiresAt: Date.now() + TTL_MS });
    return slots;
  } catch (err) {
    if (err instanceof WeatherConfigError) return [];
    if (err instanceof WeatherHttpError) console.warn(`[forecast] HTTP ${err.status}: ${err.message}`);
    else console.warn('[forecast] fetch failed:', err instanceof Error ? err.message : err);
    return [];
  }
}
