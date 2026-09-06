/**
 * The forecast SERIES behind the weather sheet — the hours ahead and the days ahead, in one shape
 * whichever provider answered. Pure: no HTTP, no config, no cache. `forecast-ahead.ts` fetches;
 * this decides what an hour and a day mean.
 *
 * Two providers, two very different raw shapes:
 *
 *   WeatherKit answers with true hours (`forecastHourly.hours`, 240 of them) and true days
 *   (`forecastDaily.days`, ten of them, each with its own high and low).
 *
 *   OpenWeatherMap's free tier answers with 3-hourly slots for five days and nothing else — there
 *   is no daily series without a paid plan. So a day is BUILT from its slots: the high is the
 *   warmest slot, the low the coldest, the condition is the slot nearest midday, the chance of
 *   rain the worst slot's. That is a fair summary of a day, and it is labelled as OWM's so the
 *   sheet can say how far ahead it actually sees.
 *
 * Nothing here pads a series out: a provider that sees five days hands back five, and the sheet
 * says so, because a fourteen-day tab filled with repeated rows would be a forecast we do not have.
 */
import { humanizeConditionCode, type WeatherKitPayload } from './weatherkit-map.ts';
import { localDateIso, type OwmForecastPayload } from './weather-map.ts';

/** One hour ahead. `at` is the instant (ISO); the sheet writes it in the user's own zone. */
export interface ForecastHourOut {
  at: string;
  temp_c: number;
  conditions: string;
  /** 0..1, or null when the provider did not say. */
  precip_chance: number | null;
}

/** One day ahead. `date` is the local calendar day (YYYY-MM-DD) in the user's zone. */
export interface ForecastDayOut {
  date: string;
  high_c: number;
  low_c: number;
  conditions: string;
  precip_chance: number | null;
}

export interface ForecastSeries {
  hourly: ForecastHourOut[];
  daily: ForecastDayOut[];
  source: 'openweathermap' | 'weatherkit';
  fetchedAt: string;
}

/** How far the sheet's tabs reach. The hourly strip is a day; the longest list is two weeks. */
export const HOURLY_HOURS = 24;
export const DAILY_DAYS = 14;

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function iso(v: unknown): Date | null {
  if (typeof v !== 'string') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * The next day's worth of entries, by the clock rather than by count: WeatherKit's hours and
 * OWM's three-hourly slots both get the same window, so the strip covers a day either way. An
 * hour that has already fully passed is not a forecast; the hour in progress stays.
 */
function withinTheDay(now: Date): (h: { at: string }) => boolean {
  const floor = now.getTime() - 3600_000;
  const ceiling = now.getTime() + HOURLY_HOURS * 3600_000;
  return (h) => {
    const t = new Date(h.at).getTime();
    return t >= floor && t < ceiling;
  };
}

/**
 * WeatherKit → series. Returns null when neither list carries a single usable entry — the same
 * contract as the snapshot mappers, so the caller falls back the same way for "errored" and
 * "answered with nothing".
 */
export function mapWeatherKitSeries(
  payload: WeatherKitPayload | null | undefined,
  timezone: string | null | undefined,
  now = new Date(),
): ForecastSeries | null {
  const hourly: ForecastHourOut[] = [];
  for (const h of payload?.forecastHourly?.hours ?? []) {
    const at = iso(h.forecastStart);
    const temp = num(h.temperature);
    if (!at || temp == null) continue;
    hourly.push({
      at: at.toISOString(),
      temp_c: Math.round(temp),
      conditions: humanizeConditionCode(h.conditionCode),
      precip_chance: num(h.precipitationChance),
    });
  }
  const daily: ForecastDayOut[] = [];
  for (const d of payload?.forecastDaily?.days ?? []) {
    const at = iso(d.forecastStart);
    const high = num(d.temperatureMax);
    const low = num(d.temperatureMin);
    if (!at || high == null || low == null) continue;
    daily.push({
      date: localDateIso(at, timezone),
      high_c: Math.round(high),
      low_c: Math.round(low),
      conditions: humanizeConditionCode(d.conditionCode),
      precip_chance: num(d.precipitationChance),
    });
  }
  return finish(hourly, daily, 'weatherkit', timezone, now);
}

/**
 * OpenWeatherMap's 3-hourly list → series. The "hourly" strip is the next day of slots — every
 * three hours, which the sheet labels honestly rather than interpolating hours it was not given.
 */
export function mapOwmSeries(
  payload: OwmForecastPayload | null | undefined,
  timezone: string | null | undefined,
  now = new Date(),
): ForecastSeries | null {
  const slots: ForecastHourOut[] = [];
  for (const item of payload?.list ?? []) {
    const dt = num(item.dt);
    const temp = num(item.main?.temp);
    if (dt == null || temp == null) continue;
    const first = item.weather?.[0];
    slots.push({
      at: new Date(dt * 1000).toISOString(),
      temp_c: Math.round(temp),
      conditions: (first?.description ?? first?.main ?? 'unknown').toLowerCase().trim() || 'unknown',
      precip_chance: num(item.pop),
    });
  }
  return finish(slots, daysFromSlots(slots, timezone), 'openweathermap', timezone, now);
}

/** Build each calendar day from the slots that fall in it (see the file header for the rules). */
export function daysFromSlots(slots: ForecastHourOut[], timezone: string | null | undefined): ForecastDayOut[] {
  const byDate = new Map<string, ForecastHourOut[]>();
  for (const s of slots) {
    const date = localDateIso(new Date(s.at), timezone);
    const list = byDate.get(date);
    if (list) list.push(s);
    else byDate.set(date, [s]);
  }
  const days: ForecastDayOut[] = [];
  for (const [date, list] of byDate) {
    let nearestNoon = list[0]!;
    let nearestGap = Infinity;
    let precip: number | null = null;
    for (const s of list) {
      const gap = Math.abs(localHour(new Date(s.at), timezone) - 12);
      if (gap < nearestGap) {
        nearestGap = gap;
        nearestNoon = s;
      }
      if (s.precip_chance != null) precip = Math.max(precip ?? 0, s.precip_chance);
    }
    days.push({
      date,
      high_c: Math.max(...list.map((s) => s.temp_c)),
      low_c: Math.min(...list.map((s) => s.temp_c)),
      conditions: nearestNoon.conditions,
      precip_chance: precip,
    });
  }
  return days;
}

/** The hour of the day (0–23) an instant falls on in `timezone`; UTC when the zone is unusable. */
export function localHour(at: Date, timezone: string | null | undefined): number {
  const tz = timezone?.trim();
  if (tz) {
    try {
      const h = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).format(at);
      const n = Number(h);
      if (Number.isFinite(n)) return n % 24; // "24" is how some engines write midnight
    } catch {
      /* invalid tz → UTC */
    }
  }
  return at.getUTCHours();
}

function finish(
  hourly: ForecastHourOut[],
  daily: ForecastDayOut[],
  source: ForecastSeries['source'],
  timezone: string | null | undefined,
  now: Date,
): ForecastSeries | null {
  const today = localDateIso(now, timezone);
  const hours = hourly.filter(withinTheDay(now)).sort(byAt);
  const days = daily
    .filter((d) => d.date >= today)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .slice(0, DAILY_DAYS);
  if (hours.length === 0 && days.length === 0) return null;
  return { hourly: hours, daily: days, source, fetchedAt: now.toISOString() };
}

function byAt(a: ForecastHourOut, b: ForecastHourOut): number {
  return a.at < b.at ? -1 : a.at > b.at ? 1 : 0;
}
