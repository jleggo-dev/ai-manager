/**
 * Pure OpenWeatherMap → Cadence weather mapping (no I/O).
 * Metric units assumed (units=metric on the request).
 */

export interface OwmCurrentPayload {
  weather?: Array<{ main?: string; description?: string }>;
  main?: { temp?: number; feels_like?: number };
  wind?: { speed?: number }; // m/s in metric
  rain?: { '1h'?: number; '3h'?: number };
  snow?: { '1h'?: number; '3h'?: number };
  name?: string;
  dt?: number;
}

export interface OwmForecastItem {
  dt?: number;
  weather?: Array<{ main?: string; description?: string }>;
  main?: { temp?: number };
  rain?: { '3h'?: number };
  snow?: { '3h'?: number };
  pop?: number; // 0..1 probability of precipitation
}

export interface OwmForecastPayload {
  list?: OwmForecastItem[];
}

/** Cadence weather snapshot used by coach context, tripwires, and occurrence jsonb. */
export interface WeatherSnapshot {
  tempC: number;
  feelsLikeC: number | null;
  windKph: number;
  conditions: string;
  precipMm: number;
  precipChance: number | null; // 0..1 from short forecast, when available
  /**
   * Which provider answered. Carried on the snapshot (not inferred from config) because the
   * ATTRIBUTION requirement is per-datum, not per-deployment: Apple requires the Apple Weather
   * mark + legal link wherever WeatherKit data is shown, and a cached or persisted snapshot may
   * predate a provider switch. Widened from the old `'openweathermap'` literal — historic rows in
   * `cadence.weather_cache` and occurrence jsonb still read back fine.
   */
  source: 'openweathermap' | 'weatherkit';
  fetchedAt: string; // ISO
  label?: string; // city name from OWM when present (WeatherKit has no place-name field)
}

/** Apple's required attribution target — shown wherever a `weatherkit` snapshot is displayed. */
export const APPLE_WEATHER_ATTRIBUTION_URL = 'https://developer.apple.com/weatherkit/data-source-attribution/';

/** True when this snapshot obliges us to show the Apple Weather mark + link. */
export function needsAppleAttribution(w: Pick<WeatherSnapshot, 'source'> | null | undefined): boolean {
  return w?.source === 'weatherkit';
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function conditionsFrom(weather: OwmCurrentPayload['weather']): string {
  const first = weather?.[0];
  const desc = typeof first?.description === 'string' ? first.description.trim() : '';
  if (desc) return desc;
  const main = typeof first?.main === 'string' ? first.main.trim() : '';
  return main || 'unknown';
}

function precipMmFrom(payload: OwmCurrentPayload): number {
  const rain1 = num(payload.rain?.['1h']) ?? 0;
  const rain3 = num(payload.rain?.['3h']) ?? 0;
  const snow1 = num(payload.snow?.['1h']) ?? 0;
  const snow3 = num(payload.snow?.['3h']) ?? 0;
  return Math.max(rain1, rain3 / 3, snow1, snow3 / 3);
}

/** Next few forecast slots → max pop (probability of precipitation). */
export function precipChanceFromForecast(forecast: OwmForecastPayload | null | undefined, slots = 4): number | null {
  const list = forecast?.list;
  if (!Array.isArray(list) || list.length === 0) return null;
  let max: number | null = null;
  for (const item of list.slice(0, slots)) {
    const pop = num(item.pop);
    if (pop == null) continue;
    max = max == null ? pop : Math.max(max, pop);
  }
  return max;
}

export function mapOwmToSnapshot(
  current: OwmCurrentPayload,
  forecast?: OwmForecastPayload | null,
  fetchedAt = new Date().toISOString(),
): WeatherSnapshot | null {
  const tempC = num(current.main?.temp);
  if (tempC == null) return null;
  const windMs = num(current.wind?.speed) ?? 0;
  const label = typeof current.name === 'string' && current.name.trim() ? current.name.trim() : undefined;
  return {
    tempC,
    feelsLikeC: num(current.main?.feels_like),
    windKph: Math.round(windMs * 3.6 * 10) / 10,
    conditions: conditionsFrom(current.weather),
    precipMm: Math.round(precipMmFrom(current) * 10) / 10,
    precipChance: precipChanceFromForecast(forecast),
    source: 'openweathermap',
    fetchedAt,
    ...(label ? { label } : {}),
  };
}

/** Round coords for cache bucketing (~11 km at equator for 1 decimal degree). */
export function roundCoord(n: number, decimals = 1): number {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}

/**
 * Cache key: rounded lat/lon + local calendar date in the given IANA timezone
 * (falls back to UTC when timezone is missing/invalid).
 */
export function weatherCacheKey(
  lat: number,
  lon: number,
  timezone: string | null | undefined,
  now = new Date(),
): string {
  const rLat = roundCoord(lat);
  const rLon = roundCoord(lon);
  const localDate = localDateIso(now, timezone);
  return `${rLat},${rLon}:${localDate}`;
}

export function localDateIso(now: Date, timezone: string | null | undefined): string {
  const tz = timezone?.trim();
  if (tz) {
    try {
      // en-CA → YYYY-MM-DD
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: tz,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(now);
    } catch {
      /* invalid tz → UTC */
    }
  }
  return now.toISOString().slice(0, 10);
}

export function localTimeLabel(now: Date, timezone: string | null | undefined): string {
  const tz = timezone?.trim() || 'UTC';
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(now);
  } catch {
    return now.toISOString();
  }
}

/** Heuristic: outdoor sessions get weather attached (run/walk/hike/cycle/outdoor category). */
export function isOutdoorActivity(category?: string | null, title?: string | null): boolean {
  const s = `${category ?? ''} ${title ?? ''}`.toLowerCase();
  return /\b(outdoor|outside|run|running|jog|walk|walking|hike|hiking|trail|cycle|cycling|bike|biking|ride)\b/.test(s);
}

/** Render a compact line for coach/job injection (deterministic facts — never LLM weather). */
export function formatWeatherLine(w: WeatherSnapshot): string {
  const feel = w.feelsLikeC != null ? `, feels like ${Math.round(w.feelsLikeC)}°C` : '';
  const precip =
    w.precipChance != null
      ? `, ~${Math.round(w.precipChance * 100)}% chance of precip next hours`
      : w.precipMm > 0
        ? `, ${w.precipMm} mm precip recently`
        : '';
  const where = w.label ? ` in ${w.label}` : '';
  return `${Math.round(w.tempC)}°C${feel}, ${w.conditions}, wind ${w.windKph} km/h${precip}${where}`;
}
