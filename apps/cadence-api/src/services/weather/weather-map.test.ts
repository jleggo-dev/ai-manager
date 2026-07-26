import { describe, it, expect } from 'vitest';
import {
  formatWeatherLine,
  isOutdoorActivity,
  localDateIso,
  mapOwmToSnapshot,
  precipChanceFromForecast,
  roundCoord,
  weatherCacheKey,
} from './weather-map.ts';

describe('weather-map', () => {
  it('maps OWM current payload to Cadence snapshot (metric)', () => {
    const snap = mapOwmToSnapshot(
      {
        name: 'Boston',
        main: { temp: 22.4, feels_like: 21.0 },
        weather: [{ main: 'Clouds', description: 'broken clouds' }],
        wind: { speed: 5 }, // m/s → 18 kph
        rain: { '1h': 0.2 },
      },
      { list: [{ pop: 0.4 }, { pop: 0.7 }, { pop: 0.1 }] },
      '2026-07-25T12:00:00.000Z',
    );
    expect(snap).toEqual({
      tempC: 22.4,
      feelsLikeC: 21,
      windKph: 18,
      conditions: 'broken clouds',
      precipMm: 0.2,
      precipChance: 0.7,
      source: 'openweathermap',
      fetchedAt: '2026-07-25T12:00:00.000Z',
      label: 'Boston',
    });
  });

  it('returns null when temperature is missing', () => {
    expect(mapOwmToSnapshot({ weather: [{ main: 'Clear' }] })).toBeNull();
  });

  it('builds cache key from rounded lat/lon + local date', () => {
    const now = new Date('2026-07-25T18:00:00.000Z');
    expect(roundCoord(42.36)).toBe(42.4);
    expect(roundCoord(-71.06)).toBe(-71.1);
    const key = weatherCacheKey(42.36, -71.06, 'America/New_York', now);
    // 18:00 UTC is still 14:00 in New York on Jul 25
    expect(key).toBe('42.4,-71.1:2026-07-25');
    expect(weatherCacheKey(42.36, -71.06, 'UTC', now)).toBe('42.4,-71.1:2026-07-25');
  });

  it('localDateIso falls back to UTC for invalid timezone', () => {
    const now = new Date('2026-07-25T01:00:00.000Z');
    expect(localDateIso(now, 'Not/A_Zone')).toBe('2026-07-25');
  });

  it('precipChanceFromForecast takes max pop across slots', () => {
    expect(precipChanceFromForecast({ list: [{ pop: 0.1 }, { pop: 0.55 }] })).toBe(0.55);
    expect(precipChanceFromForecast({ list: [] })).toBeNull();
  });

  it('detects outdoor activities by category/title', () => {
    expect(isOutdoorActivity('run', 'Easy run')).toBe(true);
    expect(isOutdoorActivity(null, 'Trail hike')).toBe(true);
    expect(isOutdoorActivity('strength', 'Goblet squats')).toBe(false);
  });

  it('formats a compact weather line without inventing facts', () => {
    const line = formatWeatherLine({
      tempC: -12,
      feelsLikeC: -18,
      windKph: 30,
      conditions: 'light snow',
      precipMm: 0,
      precipChance: 0.8,
      source: 'openweathermap',
      fetchedAt: '2026-07-25T12:00:00.000Z',
      label: 'Montreal',
    });
    expect(line).toContain('-12°C');
    expect(line).toContain('light snow');
    expect(line).toContain('80%');
    expect(line).toContain('Montreal');
  });
});
