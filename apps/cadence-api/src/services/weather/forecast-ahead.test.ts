/**
 * The forecast behind the weather sheet's tabs — what a day is built from, which provider is
 * asked, and what the sheet is told when neither has much to say.
 *
 * The rows worth pinning are the honest-degradation ones: an OWM day is a SUMMARY of its slots
 * (the warmest, the coldest, the one nearest noon), and a provider that sees five days hands back
 * five — never a fortnight padded out with repeats.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';

const { privateKey } = generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

const config = {
  weatherApiKey: 'owm-test-key',
  weatherkit: { keyId: 'K', teamId: 'T', serviceId: 'S', privateKey },
};
vi.mock('../../config.ts', () => ({ cadenceConfig: config }));
vi.mock('../../repos/users.ts', () => ({ getUser: vi.fn() }));
vi.mock('../../repos/weather-cache.ts', () => ({
  getCachedWeather: vi.fn(async () => null),
  putCachedWeather: vi.fn(async () => {}),
  pruneExpiredWeather: vi.fn(async () => {}),
}));

const { getUser } = await import('../../repos/users.ts');
const { getCachedWeather, putCachedWeather } = await import('../../repos/weather-cache.ts');
const { __setWeatherKitFetchForTests } = await import('./weatherkit-http.ts');
const { __setWeatherFetchForTests } = await import('./weather-http.ts');
const { daysFromSlots, mapOwmSeries, mapWeatherKitSeries, localHour } = await import('./forecast-series.ts');
const { getForecastAheadAt, getForecastWhereYouAre, __clearForecastAheadCacheForTests } =
  await import('./forecast-ahead.ts');

const getUserMock = getUser as unknown as ReturnType<typeof vi.fn>;
const sharedGet = getCachedWeather as unknown as ReturnType<typeof vi.fn>;
const sharedPut = putCachedWeather as unknown as ReturnType<typeof vi.fn>;

const TZ = 'America/Toronto';
/** A Tuesday at noon Toronto time (16:00Z) — on OWM's three-hour grid, so slots land on 0,3,…,21 local. */
const NOW = new Date('2026-09-08T16:00:00Z');
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

/** OWM's 3-hourly list, `n` slots from `start`, temperature climbing then falling each day. */
function owmSlots(n: number, start = NOW) {
  const list = [];
  for (let i = 0; i < n; i++) {
    const at = new Date(start.getTime() + i * 3 * 3600_000);
    const hour = localHour(at, TZ);
    list.push({
      dt: Math.floor(at.getTime() / 1000),
      main: { temp: 10 + (hour <= 12 ? hour : 24 - hour) }, // peaks at noon
      weather: [{ description: hour === 12 ? 'clear sky' : 'few clouds' }],
      pop: hour === 21 ? 0.7 : 0.1,
    });
  }
  return { list };
}

function wkPayload(hours: number, days: number) {
  return {
    currentWeather: { temperature: 20 },
    forecastHourly: {
      hours: Array.from({ length: hours }, (_, i) => ({
        forecastStart: new Date(NOW.getTime() + i * 3600_000).toISOString(),
        temperature: 20 - i * 0.4,
        conditionCode: i < 3 ? 'Clear' : 'PartlyCloudy',
        precipitationChance: i === 5 ? 0.6 : 0,
      })),
    },
    forecastDaily: {
      days: Array.from({ length: days }, (_, i) => ({
        forecastStart: new Date(Date.UTC(2026, 8, 8 + i, 4)).toISOString(), // local midnight Toronto
        temperatureMax: 25 - i,
        temperatureMin: 14 - i,
        conditionCode: i === 2 ? 'Rain' : 'MostlyClear',
        precipitationChance: i === 2 ? 0.8 : 0.05,
      })),
    },
  };
}

beforeEach(() => {
  __clearForecastAheadCacheForTests();
  __setWeatherKitFetchForTests(null);
  __setWeatherFetchForTests(null);
  getUserMock.mockReset();
  sharedGet.mockReset();
  sharedGet.mockResolvedValue(null);
  sharedPut.mockReset();
  config.weatherkit.keyId = 'K';
  config.weatherApiKey = 'owm-test-key';
});
afterEach(() => {
  __setWeatherKitFetchForTests(null);
  __setWeatherFetchForTests(null);
});

describe('a day built from three-hourly slots', () => {
  it('takes the warmest slot as the high, the coldest as the low, and the noon slot as the sky', () => {
    const series = mapOwmSeries(owmSlots(40), TZ, NOW)!;
    // Tomorrow is the first FULL day: slots at 0,3,…,21 local → temps 10,13,16,19,22,19,16,13.
    const tomorrow = series.daily[1]!;
    expect(tomorrow.date).toBe('2026-09-09');
    expect(tomorrow.high_c).toBe(22);
    expect(tomorrow.low_c).toBe(10);
    expect(tomorrow.conditions).toBe('clear sky'); // the 12:00 slot, not the most common word
    expect(tomorrow.precip_chance).toBe(0.7); // the wettest slot of the day
  });

  it('cuts days on the local calendar, not UTC', () => {
    // 23:00 Toronto on the 8th is 03:00Z on the 9th — it must still belong to the 8th.
    const late = { at: '2026-09-09T03:00:00Z', temp_c: 12, conditions: 'clear sky', precip_chance: null };
    expect(daysFromSlots([late], TZ)[0]!.date).toBe('2026-09-08');
  });

  it('keeps the hourly strip to a day of slots and the list to what the provider actually saw', () => {
    const series = mapOwmSeries(owmSlots(40), TZ, NOW)!;
    expect(series.hourly).toHaveLength(8); // 24 hours ÷ 3
    expect(series.hourly[0]!.at).toBe(NOW.toISOString());
    expect(series.daily.length).toBeLessThanOrEqual(6); // five days of slots, however they fall
    expect(series.source).toBe('openweathermap');
  });

  it('hands back nothing at all for an empty or malformed list', () => {
    expect(mapOwmSeries({ list: [] }, TZ, NOW)).toBeNull();
    expect(mapOwmSeries({ list: [{ dt: 1 }] }, TZ, NOW)).toBeNull();
    expect(mapOwmSeries(null, TZ, NOW)).toBeNull();
  });
});

describe('a WeatherKit series', () => {
  it('reads true hours and true days, de-cased, and stops at 24 hours and 14 days', () => {
    const series = mapWeatherKitSeries(wkPayload(240, 10), TZ, NOW)!;
    expect(series.hourly).toHaveLength(24);
    expect(series.hourly[0]).toEqual({ at: NOW.toISOString(), temp_c: 20, conditions: 'clear', precip_chance: 0 });
    expect(series.hourly[5]!.precip_chance).toBe(0.6);
    expect(series.hourly[5]!.conditions).toBe('partly cloudy');
    expect(series.daily).toHaveLength(10); // Apple sees ten days; the sheet is told ten, not fourteen
    expect(series.daily[0]).toEqual({
      date: '2026-09-08',
      high_c: 25,
      low_c: 14,
      conditions: 'mostly clear',
      precip_chance: 0.05,
    });
    expect(series.daily[2]!.conditions).toBe('rain');
    expect(series.source).toBe('weatherkit');
  });

  it('drops the hours already behind us, and the days too', () => {
    const payload = wkPayload(30, 3);
    // Shift everything three hours into the past: the first three hours are gone, the days stay.
    const earlier = new Date(NOW.getTime() - 3 * 3600_000);
    for (const h of payload.forecastHourly.hours) {
      h.forecastStart = new Date(new Date(h.forecastStart).getTime() - 3 * 3600_000).toISOString();
    }
    const series = mapWeatherKitSeries(payload, TZ, NOW)!;
    expect(new Date(series.hourly[0]!.at).getTime()).toBeGreaterThanOrEqual(earlier.getTime());
    expect(series.hourly[0]!.at).toBe(new Date(NOW.getTime() - 3600_000).toISOString()); // the hour in progress stays
    expect(series.daily[0]!.date).toBe('2026-09-08');
  });
});

describe('fetching it', () => {
  it('asks WeatherKit for the daily set too, and caches the answer per cell', async () => {
    const wk = vi.fn(async () => json(wkPayload(48, 10)));
    __setWeatherKitFetchForTests(wk as unknown as typeof fetch);

    const first = await getForecastAheadAt(45.4, -73.9, TZ);
    expect(first?.source).toBe('weatherkit');
    expect(first?.daily).toHaveLength(10);
    expect(String((wk.mock.calls[0] as unknown as [string])[0])).toContain(
      'dataSets=currentWeather,forecastHourly,forecastDaily',
    );

    // A neighbour in the same ~11 km cell, a minute later: no second bill.
    await getForecastAheadAt(45.42, -73.91, TZ);
    expect(wk).toHaveBeenCalledTimes(1);
    expect(sharedPut).toHaveBeenCalledWith(expect.stringMatching(/^forecast:45\.4,-73\.9:/), first, 3600_000);
  });

  it('falls back to OpenWeatherMap when WeatherKit fails, and says so in the source', async () => {
    __setWeatherKitFetchForTests(vi.fn(async () => new Response('', { status: 404 })) as unknown as typeof fetch);
    const owm = vi.fn(async () => json(owmSlots(40)));
    __setWeatherFetchForTests(owm as unknown as typeof fetch);

    const series = await getForecastAheadAt(45.4, -73.9, TZ);
    expect(series?.source).toBe('openweathermap');
    expect(String((owm.mock.calls[0] as unknown as [string])[0])).toContain('/forecast?');
    expect(String((owm.mock.calls[0] as unknown as [string])[0])).toContain('cnt=40');
  });

  it('reuses a series another instance already paid for', async () => {
    const cached = mapWeatherKitSeries(wkPayload(24, 10), TZ, NOW);
    sharedGet.mockResolvedValue(cached);
    const wk = vi.fn();
    __setWeatherKitFetchForTests(wk as unknown as typeof fetch);

    expect(await getForecastAheadAt(45.4, -73.9, TZ)).toEqual(cached);
    expect(wk).not.toHaveBeenCalled();
  });

  it('is null — never a throw — when nothing is configured or the provider errors', async () => {
    config.weatherkit.keyId = '';
    config.weatherApiKey = '';
    expect(await getForecastAheadAt(45.4, -73.9, TZ)).toBeNull();

    config.weatherApiKey = 'owm-test-key';
    __setWeatherFetchForTests(vi.fn(async () => new Response('', { status: 500 })) as unknown as typeof fetch);
    expect(await getForecastAheadAt(45.4, -73.9, TZ)).toBeNull();
  });

  it('reads the place the header draws: where you are, then home, then nowhere', async () => {
    const owm = vi.fn(async () => json(owmSlots(8)));
    config.weatherkit.keyId = '';
    __setWeatherFetchForTests(owm as unknown as typeof fetch);

    getUserMock.mockResolvedValue({
      home_location: { lat: 45.4, lon: -73.9 },
      current_location: { lat: 43.7, lon: -79.4 },
      timezone: TZ,
    });
    const away = await getForecastWhereYouAre('u1');
    expect(away?.timezone).toBe(TZ);
    expect(String((owm.mock.calls[0] as unknown as [string])[0])).toContain('lat=43.7');

    getUserMock.mockResolvedValue({ home_location: null, current_location: null, timezone: null });
    expect(await getForecastWhereYouAre('u1')).toBeNull();
  });
});
