/**
 * WeatherKit swap — the claim set and the fallback are the two things that can silently be wrong
 * in production (a bad `sub` is a 401 forever; a missing fallback is "no weather" forever), so
 * both are pinned here. Signing uses a throwaway P-256 key generated in-test — no real .p8 needed.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';

const { privateKey } = generateKeyPairSync('ec', {
  namedCurve: 'prime256v1',
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});

vi.mock('../../config.ts', () => ({
  cadenceConfig: {
    weatherApiKey: 'owm-test-key',
    weatherkit: {
      keyId: 'ABC123KEYID',
      teamId: 'TEAM123456',
      serviceId: 'dev.jleggo.cadence.weather',
      privateKey,
    },
  },
}));

vi.mock('../../repos/users.ts', () => ({ getUser: vi.fn() }));
vi.mock('../../repos/weather-cache.ts', () => ({
  getCachedWeather: vi.fn(async () => null),
  putCachedWeather: vi.fn(async () => {}),
  pruneExpiredWeather: vi.fn(async () => {}),
}));

const { weatherKitJwt, weatherKitGet, isWeatherKitConfigured, WeatherKitError, __setWeatherKitFetchForTests } =
  await import('./weatherkit-http.ts');
const { mapWeatherKitToSnapshot, humanizeConditionCode, precipChanceFromHourly } = await import('./weatherkit-map.ts');
const { needsAppleAttribution } = await import('./weather-map.ts');
const { __setWeatherFetchForTests } = await import('./weather-http.ts');

const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>;

afterEach(() => __setWeatherKitFetchForTests(null));

describe('provider JWT', () => {
  it('carries the two claims APNs does not have — header `id` and claim `sub`', () => {
    const [h, c] = weatherKitJwt(1_760_000_000_000).split('.');
    const header = decode(h!);
    const claims = decode(c!);
    // The single most error-prone field: `id` is TEAM.SERVICE, not the bundle id and not the key id.
    expect(header.id).toBe('TEAM123456.dev.jleggo.cadence.weather');
    expect(header.kid).toBe('ABC123KEYID');
    expect(header.alg).toBe('ES256');
    expect(claims.sub).toBe('dev.jleggo.cadence.weather');
    expect(claims.iss).toBe('TEAM123456');
    expect(claims.exp).toBe((claims.iat as number) + 3600);
  });

  it('reuses the token within its TTL and re-mints after it', () => {
    __setWeatherKitFetchForTests(null); // clears the cached jwt
    const t0 = weatherKitJwt(1_000_000_000_000);
    expect(weatherKitJwt(1_000_000_000_000 + 60_000)).toBe(t0);
    expect(weatherKitJwt(1_000_000_000_000 + 46 * 60_000)).not.toBe(t0);
  });

  it('reports configured when all four fields are present', () => {
    expect(isWeatherKitConfigured()).toBe(true);
  });
});

describe('weatherKitGet', () => {
  beforeEach(() => __setWeatherKitFetchForTests(null));

  it('asks for current + hourly in ONE request and sends a bearer token', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ currentWeather: { temperature: 12 } })));
    __setWeatherKitFetchForTests(fetchMock as unknown as typeof fetch);

    await weatherKitGet(51.5, -0.12, 'Europe/London');

    expect(fetchMock).toHaveBeenCalledTimes(1); // the whole point: halves OWM's two calls per miss
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/weather/en/51.5/-0.12');
    expect(url).toContain('dataSets=currentWeather,forecastHourly');
    expect(url).toContain('timezone=Europe%2FLondon');
    expect((init.headers as Record<string, string>).Authorization).toMatch(/^Bearer ey/);
  });

  it('falls back to UTC when the user has no timezone', async () => {
    const fetchMock = vi.fn(async () => new Response('{}'));
    __setWeatherKitFetchForTests(fetchMock as unknown as typeof fetch);
    await weatherKitGet(0, 0, null);
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toContain('timezone=UTC');
  });

  it('throws a typed error on 401 so the caller can fall back rather than retry', async () => {
    __setWeatherKitFetchForTests((async () => new Response('', { status: 401 })) as unknown as typeof fetch);
    await expect(weatherKitGet(1, 1)).rejects.toBeInstanceOf(WeatherKitError);
  });

  it('cools down after a 429 instead of hammering a rate-limited key', async () => {
    const fetchMock = vi.fn(async () => new Response('', { status: 429 }));
    __setWeatherKitFetchForTests(fetchMock as unknown as typeof fetch);
    await expect(weatherKitGet(1, 1)).rejects.toThrow(/rate limit/);
    await expect(weatherKitGet(1, 1)).rejects.toThrow(/cooling down/);
    expect(fetchMock).toHaveBeenCalledTimes(1); // the second call never left the process
  });
});

describe('WeatherKit → snapshot mapping', () => {
  it('de-cases the condition enum so the coach does not say "PartlyCloudy"', () => {
    expect(humanizeConditionCode('PartlyCloudy')).toBe('partly cloudy');
    expect(humanizeConditionCode('MostlyClear')).toBe('mostly clear');
    expect(humanizeConditionCode('Rain')).toBe('rain');
    expect(humanizeConditionCode(undefined)).toBe('unknown');
  });

  it('takes wind as km/h — NOT m/s like OWM', () => {
    const snap = mapWeatherKitToSnapshot({ currentWeather: { temperature: 10, windSpeed: 18 } });
    expect(snap?.windKph).toBe(18); // an m/s reading would have become 64.8
  });

  it('maps a full payload and stamps the source for attribution', () => {
    const snap = mapWeatherKitToSnapshot(
      {
        currentWeather: {
          temperature: 17.4,
          temperatureApparent: 16.1,
          windSpeed: 11.2,
          conditionCode: 'PartlyCloudy',
          precipitationIntensity: 0.6,
        },
        forecastHourly: { hours: [{ precipitationChance: 0.1 }, { precipitationChance: 0.55 }] },
      },
      '2026-08-07T09:00:00.000Z',
    );
    expect(snap).toEqual({
      tempC: 17.4,
      feelsLikeC: 16.1,
      windKph: 11.2,
      conditions: 'partly cloudy',
      precipMm: 0.6,
      precipChance: 0.55,
      source: 'weatherkit',
      fetchedAt: '2026-08-07T09:00:00.000Z',
    });
    expect(needsAppleAttribution(snap)).toBe(true);
  });

  it('returns null without a temperature, so the caller falls back like any other failure', () => {
    expect(mapWeatherKitToSnapshot({ currentWeather: { conditionCode: 'Clear' } })).toBeNull();
    expect(mapWeatherKitToSnapshot({})).toBeNull();
  });

  it('sets no label — WeatherKit has no place name and inventing one misquotes the coach', () => {
    expect(mapWeatherKitToSnapshot({ currentWeather: { temperature: 5 } })).not.toHaveProperty('label');
  });

  it('does not oblige Apple attribution for OWM snapshots', () => {
    expect(needsAppleAttribution({ source: 'openweathermap' })).toBe(false);
    expect(needsAppleAttribution(null)).toBe(false);
  });

  it('reads precip chance as the max over the next slots', () => {
    expect(precipChanceFromHourly({ forecastHourly: { hours: [{ precipitationChance: 0.2 }] } })).toBe(0.2);
    expect(precipChanceFromHourly({ forecastHourly: { hours: [] } })).toBeNull();
    expect(precipChanceFromHourly({})).toBeNull();
  });
});

/**
 * The provider-selection seam. These are the regressions with no visible symptom in dev (where
 * WEATHERKIT_* is usually unset): pick the wrong branch and every user quietly loses weather, or
 * quietly gets the provider this swap existed to stop quoting.
 */
describe('provider selection and fallback', () => {
  beforeEach(async () => {
    const { __clearWeatherCacheForTests } = await import('./weather.ts');
    __clearWeatherCacheForTests();
    __setWeatherKitFetchForTests(null);
    __setWeatherFetchForTests(null);
  });
  afterEach(() => __setWeatherFetchForTests(null));

  const okWeatherKit = () =>
    new Response(JSON.stringify({ currentWeather: { temperature: 21, conditionCode: 'Clear', windSpeed: 5 } }));
  const okOwm = () =>
    new Response(JSON.stringify({ main: { temp: 9 }, weather: [{ description: 'light rain' }], name: 'London' }));

  it('prefers WeatherKit when configured, and never calls OpenWeatherMap', async () => {
    const { getWeatherAt } = await import('./weather.ts');
    const owm = vi.fn(async () => okOwm());
    __setWeatherKitFetchForTests((async () => okWeatherKit()) as unknown as typeof fetch);
    __setWeatherFetchForTests(owm as unknown as typeof fetch);

    const w = await getWeatherAt(51.5, -0.12, 'Europe/London');
    expect(w?.source).toBe('weatherkit');
    expect(w?.tempC).toBe(21);
    expect(owm).not.toHaveBeenCalled();
  });

  it('falls back to OpenWeatherMap when WeatherKit errors', async () => {
    const { getWeatherAt } = await import('./weather.ts');
    __setWeatherKitFetchForTests((async () => new Response('', { status: 500 })) as unknown as typeof fetch);
    __setWeatherFetchForTests((async () => okOwm()) as unknown as typeof fetch);

    const w = await getWeatherAt(1.5, 2.5, 'UTC');
    expect(w?.source).toBe('openweathermap');
    expect(w?.tempC).toBe(9);
  });

  it('falls back when WeatherKit answers with an unmappable payload (404-shaped no-data)', async () => {
    const { getWeatherAt } = await import('./weather.ts');
    __setWeatherKitFetchForTests((async () => new Response('{}')) as unknown as typeof fetch);
    __setWeatherFetchForTests((async () => okOwm()) as unknown as typeof fetch);

    const w = await getWeatherAt(3.5, 4.5, 'UTC');
    expect(w?.source).toBe('openweathermap');
  });

  it('returns null when both providers fail, rather than throwing into session generation', async () => {
    const { getWeatherAt } = await import('./weather.ts');
    __setWeatherKitFetchForTests((async () => new Response('', { status: 500 })) as unknown as typeof fetch);
    __setWeatherFetchForTests((async () => new Response('', { status: 500 })) as unknown as typeof fetch);

    await expect(getWeatherAt(5.5, 6.5, 'UTC')).resolves.toBeNull();
  });
});
