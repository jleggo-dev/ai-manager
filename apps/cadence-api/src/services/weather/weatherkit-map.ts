/**
 * Pure Apple WeatherKit → Cadence weather mapping (no I/O).
 *
 * WeatherKit returns SI units natively (°C, m/s, mm), so unlike OWM there is no `units=` request
 * parameter to get wrong — but two shapes still differ enough to matter:
 *
 *  1. Conditions arrive as a CamelCase enum (`PartlyCloudy`, `HeavyRain`), not prose. The coach
 *     injects this string into a sentence, so it has to be de-cased or the user reads
 *     "17°C, PartlyCloudy" — which is exactly the "quoting the wrong source" tell this swap exists
 *     to remove.
 *  2. Precipitation is a RATE (mm/hr, `precipitationIntensity`) rather than an accumulation over a
 *     past window. Over one hour the two are numerically the same, which is the window OWM's
 *     `rain.1h` uses and what `WeatherSnapshot.precipMm` has always meant, so they map directly.
 */
import type { WeatherSnapshot } from './weather-map.ts';

/** Only the fields Cadence reads — WeatherKit returns far more. */
export interface WeatherKitCurrent {
  temperature?: number; // °C
  temperatureApparent?: number; // °C
  windSpeed?: number; // km/h (WeatherKit is km/h here, NOT m/s like OWM)
  conditionCode?: string; // CamelCase enum
  precipitationIntensity?: number; // mm/hr
  metadata?: { readTime?: string };
}

export interface WeatherKitHourly {
  forecastStart?: string;
  precipitationChance?: number; // 0..1
  temperature?: number; // °C
  conditionCode?: string; // CamelCase enum
}

/** One calendar day of `forecastDaily` — only the fields the weather sheet's day rows read. */
export interface WeatherKitDaily {
  forecastStart?: string;
  temperatureMax?: number; // °C
  temperatureMin?: number; // °C
  conditionCode?: string;
  precipitationChance?: number; // 0..1
}

export interface WeatherKitPayload {
  currentWeather?: WeatherKitCurrent;
  forecastHourly?: { hours?: WeatherKitHourly[] };
  /** Present only when the request asked for it (`forecast-ahead.ts` does; the snapshot path does not). */
  forecastDaily?: { days?: WeatherKitDaily[] };
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * `PartlyCloudy` → `partly cloudy`. Kept lowercase to match how OWM's `description` already reads,
 * so `formatWeatherLine` produces the same sentence shape regardless of which provider answered.
 */
export function humanizeConditionCode(code: string | undefined): string {
  const raw = (code ?? '').trim();
  if (!raw) return 'unknown';
  return (
    raw
      // split CamelCase, but keep runs of capitals together (e.g. "MostlyClear", not "M ostly")
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .toLowerCase()
      .trim() || 'unknown'
  );
}

/** Max precipitation chance over the next few hourly slots — the same read as OWM's `pop`. */
export function precipChanceFromHourly(payload: WeatherKitPayload | null | undefined, slots = 4): number | null {
  const hours = payload?.forecastHourly?.hours;
  if (!Array.isArray(hours) || hours.length === 0) return null;
  let max: number | null = null;
  for (const h of hours.slice(0, slots)) {
    const p = num(h.precipitationChance);
    if (p == null) continue;
    max = max == null ? p : Math.max(max, p);
  }
  return max;
}

/**
 * Map a WeatherKit response to the shared snapshot. Returns null when temperature is missing —
 * same contract as `mapOwmToSnapshot`, so the caller's fallback path is identical for
 * "provider errored" and "provider answered with something unusable".
 *
 * `label` is deliberately NOT set: WeatherKit has no place-name field (it answers for coordinates,
 * not cities), and inventing one would put a wrong city in the coach's mouth. The Today header
 * already carries its own city label from the geocoder.
 */
export function mapWeatherKitToSnapshot(
  payload: WeatherKitPayload,
  fetchedAt = new Date().toISOString(),
): WeatherSnapshot | null {
  const current = payload.currentWeather;
  const tempC = num(current?.temperature);
  if (tempC == null) return null;
  return {
    tempC,
    feelsLikeC: num(current?.temperatureApparent),
    windKph: Math.round((num(current?.windSpeed) ?? 0) * 10) / 10,
    conditions: humanizeConditionCode(current?.conditionCode),
    precipMm: Math.round((num(current?.precipitationIntensity) ?? 0) * 10) / 10,
    precipChance: precipChanceFromHourly(payload),
    source: 'weatherkit',
    fetchedAt,
  };
}
