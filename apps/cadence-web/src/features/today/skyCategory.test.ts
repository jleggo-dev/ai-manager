/**
 * The sky router (skyCategory.ts) decides which of eleven skies a day is drawn under, and a router
 * that decides behaviour ships with positives AND near-misses: the wrong sky never throws, it
 * just quietly draws a blizzard over a dusting. Inputs are the API's humanized strings — WeatherKit
 * codes de-cased ("partly cloudy", "sun flurries") and OpenWeatherMap descriptions as they come.
 */
import { SKY_CATEGORIES, daySkies, skyCategory, type SkyCategory } from './skyCategory.ts';

describe('skyCategory', () => {
  const table: [string, SkyCategory][] = [
    // clear — and the near-misses that mention clouds or heat but keep today's look
    ['clear', 'clear'],
    ['mostly clear', 'clear'],
    ['hot', 'clear'],
    ['frigid', 'clear'],
    ['few clouds', 'clear'],
    ['clear sky', 'clear'],
    // partly cloudy: the two WeatherKit words and OWM's scattered/broken
    ['partly cloudy', 'partly-cloudy'],
    ['mostly cloudy', 'partly-cloudy'],
    ['scattered clouds', 'partly-cloudy'],
    ['broken clouds', 'partly-cloudy'],
    // overcast: the plain cloud words
    ['cloudy', 'overcast'],
    ['overcast', 'overcast'],
    ['overcast clouds', 'overcast'],
    // light rain
    ['drizzle', 'light-rain'],
    ['rain', 'light-rain'],
    ['light rain', 'light-rain'],
    ['sun showers', 'light-rain'],
    ['freezing drizzle', 'light-rain'],
    ['shower rain', 'light-rain'],
    ['light intensity drizzle', 'light-rain'],
    ['moderate rain', 'light-rain'],
    // heavy rain — never the light sky
    ['heavy rain', 'heavy-rain'],
    ['freezing rain', 'heavy-rain'],
    ['heavy intensity rain', 'heavy-rain'],
    ['very heavy rain', 'heavy-rain'],
    ['heavy intensity shower rain', 'heavy-rain'],
    // thunderstorm outranks whatever it carries
    ['thunderstorm', 'thunderstorm'],
    ['thunderstorm with heavy rain', 'thunderstorm'],
    ['thunderstorm with light drizzle', 'thunderstorm'],
    ['isolated thunderstorms', 'thunderstorm'],
    ['strong storms', 'thunderstorm'],
    ['tropical storm', 'thunderstorm'],
    ['hurricane', 'thunderstorm'],
    // windy
    ['breezy', 'windy'],
    ['windy', 'windy'],
    ['blowing dust', 'windy'],
    // hail / sleet / wintry mix — ice, not snow and not rain
    ['hail', 'hail'],
    ['sleet', 'hail'],
    ['wintry mix', 'hail'],
    ['rain and snow', 'light-snow'],
    // light snow — including plain "snow"
    ['flurries', 'light-snow'],
    ['snow', 'light-snow'],
    ['light snow', 'light-snow'],
    ['sun flurries', 'light-snow'],
    ['scattered snow showers', 'light-snow'],
    // heavy snow — the near-misses above must not land here
    ['heavy snow', 'heavy-snow'],
    ['blizzard', 'heavy-snow'],
    ['blowing snow', 'heavy-snow'],
    ['heavy shower snow', 'heavy-snow'],
    // fog
    ['fog', 'fog'],
    ['foggy', 'fog'],
    ['haze', 'fog'],
    ['mist', 'fog'],
    ['smoky', 'fog'],
    ['smoke', 'fog'],
  ];

  it.each(table)('%s → %s', (conditions, expected) => {
    expect(skyCategory(conditions)).toBe(expected);
  });

  it('is clear for nothing at all — an absent forecast draws nothing', () => {
    expect(skyCategory(undefined)).toBe('clear');
    expect(skyCategory('')).toBe('clear');
    expect(skyCategory('   ')).toBe('clear');
    expect(skyCategory('unknown')).toBe('clear');
  });

  it('reads case and padding the way the providers send them', () => {
    expect(skyCategory('Heavy Rain')).toBe('heavy-rain');
    expect(skyCategory('  Overcast ')).toBe('overcast');
  });

  it('only ever answers with a listed category', () => {
    for (const [c] of table) expect(SKY_CATEGORIES).toContain(skyCategory(c));
  });
});

describe('daySkies', () => {
  const days = [
    { date: '2026-09-07', isToday: true },
    { date: '2026-09-08', isToday: false },
    { date: '2026-09-09', isToday: false },
  ];
  const forecast = {
    available: true,
    daily: [
      { date: '2026-09-07', high_c: 20, low_c: 12, conditions: 'partly cloudy', precip_chance: 0.1 },
      { date: '2026-09-08', high_c: 18, low_c: 11, conditions: 'heavy rain', precip_chance: 0.9 },
    ],
  };

  it('draws today from the current reading and later days from the forecast by date', () => {
    expect(daySkies(days, { available: true, conditions: 'fog' }, forecast)).toEqual({
      '2026-09-07': 'fog',
      '2026-09-08': 'heavy-rain',
      '2026-09-09': 'clear', // past the forecast's reach — the untouched sky
    });
  });

  it('falls back to the forecast row for today when the reading is missing', () => {
    expect(daySkies(days, undefined, forecast)['2026-09-07']).toBe('partly-cloudy');
    expect(daySkies(days, { available: false }, forecast)['2026-09-07']).toBe('partly-cloudy');
  });

  it('is clear everywhere before anything has arrived, or when the provider said no', () => {
    expect(daySkies(days, undefined, undefined)).toEqual({
      '2026-09-07': 'clear',
      '2026-09-08': 'clear',
      '2026-09-09': 'clear',
    });
    expect(daySkies(days, undefined, { available: false, daily: forecast.daily })['2026-09-08']).toBe('clear');
  });
});
