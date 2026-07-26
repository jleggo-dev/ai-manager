import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../config.ts', () => ({
  cadenceConfig: { weatherApiKey: 'test-key-not-real' },
}));

vi.mock('../../repos/users.ts', () => ({
  getUser: vi.fn(),
}));

import { getUser } from '../../repos/users.ts';
import { __setWeatherFetchForTests } from './weather-http.ts';
import { __clearWeatherCacheForTests, getWeatherAt, getWeatherForUser, isWeatherConfigured } from './weather.ts';

const getUserMock = getUser as unknown as ReturnType<typeof vi.fn>;

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
