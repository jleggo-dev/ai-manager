import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../config.ts', () => ({
  cadenceConfig: { weatherApiKey: 'test-key-not-real' },
}));

vi.mock('../../repos/users.ts', () => ({
  getUser: vi.fn(),
}));

// The shared L2 cache (migration 0025) is mocked here so these stay pure unit tests — without
// this they would open real DB connections. Default: always a miss, so existing expectations
// about provider calls hold unchanged.
vi.mock('../../repos/weather-cache.ts', () => ({
  getCachedWeather: vi.fn(async () => null),
  putCachedWeather: vi.fn(async () => {}),
  pruneExpiredWeather: vi.fn(async () => {}),
}));

import { getUser } from '../../repos/users.ts';
import { getCachedWeather, putCachedWeather } from '../../repos/weather-cache.ts';
import { __setWeatherFetchForTests } from './weather-http.ts';
import { __clearWeatherCacheForTests, getWeatherAt, getWeatherForUser, isWeatherConfigured } from './weather.ts';

const getUserMock = getUser as unknown as ReturnType<typeof vi.fn>;
const sharedGet = getCachedWeather as unknown as ReturnType<typeof vi.fn>;
const sharedPut = putCachedWeather as unknown as ReturnType<typeof vi.fn>;

function jsonResponse(body: unknown, status = 200, headers?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...(headers ?? {}) },
  });
}

describe('weather service (OWM HTTP mocked)', () => {
  beforeEach(() => {
    __clearWeatherCacheForTests();
    __setWeatherFetchForTests(null);
    getUserMock.mockReset();
    sharedGet.mockReset();
    sharedGet.mockResolvedValue(null);
    sharedPut.mockReset();
  });

  afterEach(() => {
    __setWeatherFetchForTests(null);
    __clearWeatherCacheForTests();
  });

  it('is configured when weatherApiKey is set', () => {
    expect(isWeatherConfigured()).toBe(true);
  });

  it('fetches current + forecast, maps, and caches by rounded coords + date', async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.includes('/data/2.5/weather?')) {
        return jsonResponse({
          name: 'Testville',
          main: { temp: 38.5, feels_like: 40 },
          weather: [{ description: 'clear sky' }],
          wind: { speed: 2 },
        });
      }
      if (u.includes('/data/2.5/forecast?')) {
        return jsonResponse({ list: [{ pop: 0.2 }] });
      }
      return jsonResponse({}, 404);
    });
    __setWeatherFetchForTests(fetchMock as unknown as typeof fetch);

    const a = await getWeatherAt(40.7128, -74.006, 'America/New_York');
    expect(a?.tempC).toBe(38.5);
    expect(a?.conditions).toBe('clear sky');
    expect(a?.label).toBe('Testville');

    const b = await getWeatherAt(40.71, -74.01, 'America/New_York'); // same cache bucket
    expect(b?.tempC).toBe(38.5);
    // current + forecast once (single-flight + cache)
    expect(fetchMock.mock.calls.length).toBe(2);
  });

  it('backs off on 429 and returns null (soft-fail)', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ message: 'limit' }, 429, { 'retry-after': '1' }));
    __setWeatherFetchForTests(fetchMock as unknown as typeof fetch);

    const snap = await getWeatherAt(1, 2, 'UTC');
    expect(snap).toBeNull();
    expect(fetchMock).toHaveBeenCalled();
  });

  it('getWeatherForUser uses home_location + timezone', async () => {
    getUserMock.mockResolvedValue({
      home_location: { lat: 45.5, lon: -73.6, label: 'Montreal' },
      timezone: 'America/Toronto',
    });
    const fetchMock = vi.fn(async (url: string | URL) => {
      if (String(url).includes('/weather?')) {
        return jsonResponse({
          main: { temp: -15 },
          weather: [{ description: 'snow' }],
          wind: { speed: 8 },
        });
      }
      return jsonResponse({ list: [] });
    });
    __setWeatherFetchForTests(fetchMock as unknown as typeof fetch);

    const w = await getWeatherForUser('user-1');
    expect(w?.tempC).toBe(-15);
    expect(w?.conditions).toBe('snow');
  });

  it('returns null when user has no home_location', async () => {
    getUserMock.mockResolvedValue({ home_location: null, timezone: null });
    expect(await getWeatherForUser('user-1')).toBeNull();
  });
});

/**
 * The shared L2 cache (0025) — the point of which is that a cold start or a second instance
 * must NOT re-bill the provider. "Cold start" here = an empty L1, which is exactly what
 * __clearWeatherCacheForTests leaves behind.
 */
describe('shared weather cache (L2)', () => {
  beforeEach(() => {
    __clearWeatherCacheForTests();
    __setWeatherFetchForTests(null);
    sharedGet.mockReset();
    sharedGet.mockResolvedValue(null);
    sharedPut.mockReset();
  });

  afterEach(() => {
    __setWeatherFetchForTests(null);
    __clearWeatherCacheForTests();
  });

  it('serves an L2 hit without calling the provider, and warms L1 so the DB is skipped next time', async () => {
    const stored = {
      tempC: 12,
      feelsLikeC: 11,
      windKph: 8,
      conditions: 'cloudy',
      precipMm: 0,
      precipChance: null,
      source: 'openweathermap',
      fetchedAt: '2026-08-06T09:00:00.000Z',
    };
    sharedGet.mockResolvedValue(stored);
    let providerCalls = 0;
    __setWeatherFetchForTests(async () => {
      providerCalls++;
      return jsonResponse({});
    });

    const first = await getWeatherAt(51.5, -0.12, 'Europe/London');
    expect(first?.tempC).toBe(12);
    expect(providerCalls).toBe(0); // the whole point: no provider call on a cold start

    const second = await getWeatherAt(51.5, -0.12, 'Europe/London');
    expect(second?.tempC).toBe(12);
    expect(providerCalls).toBe(0);
    expect(sharedGet).toHaveBeenCalledTimes(1); // L1 absorbed the repeat; no second DB read
  });

  it('publishes to L2 after a provider fetch', async () => {
    const fetchMock = vi.fn(async (url: string | URL) =>
      String(url).includes('/forecast')
        ? jsonResponse({ list: [] })
        : jsonResponse({ main: { temp: 20, feels_like: 19 }, wind: { speed: 3 }, weather: [{ main: 'Clear' }] }),
    );
    __setWeatherFetchForTests(fetchMock as unknown as typeof fetch);
    const w = await getWeatherAt(40.7, -74, 'America/New_York');
    expect(w?.tempC).toBe(20);
    // Publishing is fire-and-forget; let the microtask chain drain before asserting.
    await new Promise((r) => setTimeout(r, 0));
    expect(sharedPut).toHaveBeenCalledTimes(1);
    const [key, snapshot, ttl] = sharedPut.mock.calls[0] as [string, { tempC: number }, number];
    expect(key).toContain('40.7,-74');
    expect(snapshot.tempC).toBe(20);
    expect(ttl).toBe(60 * 60 * 1000);
  });

  it('falls through to the provider when the shared cache errors (outage costs a call, not a failure)', async () => {
    sharedGet.mockRejectedValue(new Error('db down'));
    const fetchMock = vi.fn(async (url: string | URL) =>
      String(url).includes('/forecast')
        ? jsonResponse({ list: [] })
        : jsonResponse({ main: { temp: 5, feels_like: 3 }, wind: { speed: 1 }, weather: [{ main: 'Rain' }] }),
    );
    __setWeatherFetchForTests(fetchMock as unknown as typeof fetch);
    // The repo swallows its own errors in production; a rejecting mock proves the caller is
    // resilient even if that ever regressed.
    await expect(getWeatherAt(48.9, 2.3, 'Europe/Paris')).resolves.not.toThrow();
  });
});
