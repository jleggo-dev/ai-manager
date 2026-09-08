import type { Forecast, WeatherNow } from '../../lib/api.ts';

/**
 * Which sky a day on the trail is drawn under (owner, 2026-09-07: "the background of a day on the
 * Plan screen [should reflect] the forecast" — see docs/cadence/DESIGN-weather-skies.md).
 *
 * The input is the API's humanized condition: a WeatherKit code CamelCase-split and lowercased
 * (`weatherkit-map.ts` `humanizeConditionCode` — "partly cloudy", "heavy rain", "sun flurries") or
 * an OpenWeatherMap description as it comes ("overcast clouds", "thunderstorm with heavy rain",
 * "light intensity drizzle"). Eleven categories cover every word either provider uses; the router
 * decides which one, and a router that decides behaviour ships with a table of positives AND
 * near-misses (`skyCategory.test.ts`) — "light snow" must never land on the heavy-snow sky, and
 * "thunderstorm with heavy rain" must land on the storm, not the rain.
 */
export type SkyCategory =
  | 'clear'
  | 'partly-cloudy'
  | 'overcast'
  | 'light-rain'
  | 'heavy-rain'
  | 'thunderstorm'
  | 'windy'
  | 'hail'
  | 'light-snow'
  | 'heavy-snow'
  | 'fog';

/** Every category, in the order the sheet lists them. */
export const SKY_CATEGORIES: readonly SkyCategory[] = [
  'clear',
  'partly-cloudy',
  'overcast',
  'light-rain',
  'heavy-rain',
  'thunderstorm',
  'windy',
  'hail',
  'light-snow',
  'heavy-snow',
  'fog',
];

/**
 * The checks, most specific first. Order is the whole point:
 *  - a storm outranks the rain it carries ("thunderstorm with heavy rain");
 *  - hail / sleet / wintry mix outrank snow AND rain (both words can appear beside them);
 *  - heavy snow before snow, so "light snow" and plain "snow" fall through to the light sky;
 *  - fog before wind before rain: "blowing dust" is wind, never dust; "mist" is fog, never rain;
 *  - heavy rain before rain, so "light rain" / "drizzle" / "shower" take the light sky;
 *  - "partly cloudy" / "mostly cloudy" / "scattered" / "broken" before the plain cloud words,
 *    which are the overcast ones; "few clouds" and "mostly clear" are a clear day.
 */
const ROUTES: readonly (readonly [RegExp, SkyCategory])[] = [
  [/thunder|storm|hurricane|tropical/, 'thunderstorm'],
  [/hail|sleet|wintry mix/, 'hail'],
  [/heavy .*snow|blizzard|blowing snow/, 'heavy-snow'],
  [/snow|flurr/, 'light-snow'],
  [/fog|haze|mist|smok/, 'fog'],
  [/breezy|windy|blowing dust/, 'windy'],
  [/heavy .*rain|extreme rain|freezing rain|heavy intensity/, 'heavy-rain'],
  [/drizzle|rain|shower/, 'light-rain'],
  [/partly cloudy|mostly cloudy|scattered clouds|broken clouds/, 'partly-cloudy'],
  [/overcast|cloudy/, 'overcast'],
];

/** The sky for a condition string. Unknown, empty, or absent → clear: exactly today's look. */
export function skyCategory(conditions: string | undefined): SkyCategory {
  const c = (conditions ?? '').trim().toLowerCase();
  if (!c) return 'clear';
  for (const [re, category] of ROUTES) if (re.test(c)) return category;
  return 'clear';
}

/** The trail's days, as much of them as the sky needs. */
export type SkyDay = { date: string; isToday: boolean };

/**
 * One sky per day of the week, keyed by date.
 *
 * Today reads the CURRENT conditions (`/me/weather`) — what is outside the window now, not what
 * the morning's forecast said — and falls back to the forecast's own row for the date when the
 * reading is missing. Every later day reads the forecast day with the matching date. A day the
 * forecast does not reach (OpenWeatherMap sees five days; the plan can run seven or more) and a
 * day before the reading arrives are both `'clear'`, which draws nothing at all: the untouched
 * Linen sky, no decor, so an absent forecast is invisible rather than wrong.
 */
export function daySkies(
  days: readonly SkyDay[],
  weather: WeatherNow | undefined,
  forecast: Forecast | undefined,
): Record<string, SkyCategory> {
  const daily = forecast?.available ? (forecast.daily ?? []) : [];
  const now = weather?.available ? weather.conditions : undefined;
  const skies: Record<string, SkyCategory> = {};
  for (const day of days) {
    const ahead = daily.find((d) => d.date === day.date)?.conditions;
    skies[day.date] = skyCategory(day.isToday ? (now ?? ahead) : ahead);
  }
  return skies;
}
