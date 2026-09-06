/**
 * GET /me/forecast — the shape the weather sheet is handed, and the two things that must hold
 * whatever the provider did: `available:false` is an answer and not an error, and the Apple
 * attribution follows the series' own source.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';

const getForecastWhereYouAre = vi.fn();

vi.mock('../repos/users.ts', () => ({
  getUser: vi.fn(),
  setHomeLocation: vi.fn(),
  clearHomeLocation: vi.fn(),
  setCurrentLocation: vi.fn(),
  clearCurrentLocation: vi.fn(),
  mergeBaseline: vi.fn(),
  mergeUnitPrefs: vi.fn(),
}));
vi.mock('../services/weather/weather.ts', () => ({
  reverseGeocode: vi.fn(),
  geocodeCity: vi.fn(),
  getWeatherWhereYouAre: vi.fn(async () => null),
  needsAppleAttribution: (w: { source?: string }) => w?.source === 'weatherkit',
  APPLE_WEATHER_ATTRIBUTION_URL: 'https://example.invalid/apple',
}));
vi.mock('../services/weather/forecast-ahead.ts', () => ({
  getForecastWhereYouAre: (...a: unknown[]) => getForecastWhereYouAre(...a),
}));
// Neighbours on the same router, mocked only so importing it never reaches db/sql.ts or AI Admin.
vi.mock('../services/dev-reset.ts', () => ({ resetUserData: vi.fn() }));
vi.mock('../services/dev-trace.ts', () => ({ clearTrace: vi.fn() }));
vi.mock('../ai/aim.ts', () => ({ AimError: class extends Error {}, purgeUserAiData: vi.fn() }));
vi.mock('../services/day-recap.ts', () => ({ getDayRecap: vi.fn(async () => null) }));
vi.mock('../services/now-menu.ts', () => ({ getNowMenu: vi.fn(async () => []) }));
vi.mock('../auth/middleware.ts', () => ({
  requireCadenceUser: (req: { cadenceUserId?: string }, _res: unknown, next: () => void) => {
    req.cadenceUserId = 'u1';
    next();
  },
}));

const { default: meRoutes } = await import('./me.ts');

interface Body {
  available?: boolean;
  timezone?: string | null;
  hourly?: unknown[];
  daily?: unknown[];
  source?: string;
  attribution?: { name: string; url: string } | null;
  error?: string;
}

async function get(path: string) {
  const app = express();
  app.use('/me', meRoutes);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    return { status: res.status, body: ((await res.json().catch(() => ({}))) ?? {}) as Body };
  } finally {
    server.close();
  }
}

const SERIES = {
  hourly: [{ at: '2026-09-08T18:00:00.000Z', temp_c: 20, conditions: 'clear', precip_chance: 0 }],
  daily: [{ date: '2026-09-08', high_c: 25, low_c: 14, conditions: 'mostly clear', precip_chance: 0.05 }],
  fetchedAt: '2026-09-08T18:00:00.000Z',
};

beforeEach(() => vi.clearAllMocks());

describe('GET /me/forecast', () => {
  it('hands the sheet the hours, the days, the zone they were cut on, and Apple’s link for Apple’s data', async () => {
    getForecastWhereYouAre.mockResolvedValue({
      series: { ...SERIES, source: 'weatherkit' },
      timezone: 'America/Toronto',
    });
    const { status, body } = await get('/me/forecast');
    expect(status).toBe(200);
    expect(body.available).toBe(true);
    expect(body.timezone).toBe('America/Toronto');
    expect(body.hourly).toEqual(SERIES.hourly);
    expect(body.daily).toEqual(SERIES.daily);
    expect(body.source).toBe('weatherkit');
    expect(body.attribution).toEqual({ name: 'Apple Weather', url: 'https://example.invalid/apple' });
    expect(getForecastWhereYouAre).toHaveBeenCalledWith('u1');
  });

  it('carries no Apple link for an OpenWeatherMap series', async () => {
    getForecastWhereYouAre.mockResolvedValue({ series: { ...SERIES, source: 'openweathermap' }, timezone: null });
    const { body } = await get('/me/forecast');
    expect(body.attribution).toBeNull();
  });

  it('says unavailable — as a 200 — when there is no place or no provider', async () => {
    getForecastWhereYouAre.mockResolvedValue(null);
    const { status, body } = await get('/me/forecast');
    expect(status).toBe(200);
    expect(body).toEqual({ available: false });
  });

  it('is a 500 only when the read itself threw', async () => {
    getForecastWhereYouAre.mockRejectedValue(new Error('db down'));
    const { status, body } = await get('/me/forecast');
    expect(status).toBe(500);
    expect(body.error).toBe('failed to load forecast');
  });
});
