/**
 * The location routes, after where-you-live and where-you-are stopped being one field (A21).
 *
 * What is worth pinning is the SEPARATION, because breaking it is silent: nothing on screen would
 * tell you that a commute had walked the notification anchor downtown. So every test here asks the
 * same question from a different side — did home move when it shouldn't have, and did the header's
 * point move when it should?
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';

const getUser = vi.fn();
const setHome = vi.fn(async (..._a: unknown[]) => {});
const clearHome = vi.fn(async (..._a: unknown[]) => {});
const setCurrent = vi.fn(async (..._a: unknown[]) => {});
const clearCurrent = vi.fn(async (..._a: unknown[]) => {});
const reverseGeocode = vi.fn(async (..._a: unknown[]) => null as string | null);

vi.mock('../repos/users.ts', () => ({
  getUser: (...a: unknown[]) => getUser(...a),
  setHomeLocation: (...a: unknown[]) => setHome(...a),
  clearHomeLocation: (...a: unknown[]) => clearHome(...a),
  setCurrentLocation: (...a: unknown[]) => setCurrent(...a),
  clearCurrentLocation: (...a: unknown[]) => clearCurrent(...a),
  mergeBaseline: vi.fn(),
  mergeUnitPrefs: vi.fn(),
}));
vi.mock('../services/weather/weather.ts', () => ({
  reverseGeocode: (...a: unknown[]) => reverseGeocode(...a),
  geocodeCity: vi.fn(),
  getWeatherWhereYouAre: vi.fn(async () => null),
  needsAppleAttribution: () => false,
  APPLE_WEATHER_ATTRIBUTION_URL: 'https://example.invalid',
}));
// Everything below is a neighbour on the same router, mocked only so importing it never reaches
// db/sql.ts or AI Admin.
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

const HOME = { lat: 45.4, lon: -73.9, label: "Notre-Dame-de-l'Île-Perrot, CA" };
const DOWNTOWN = { lat: 45.5, lon: -73.57 };

interface Body {
  home_location?: unknown;
  current_location?: unknown;
  timezone?: unknown;
  error?: string;
}

async function call(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown) {
  const app = express();
  app.use(express.json());
  app.use('/me', meRoutes);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: res.status, body: ((await res.json().catch(() => ({}))) ?? {}) as Body };
  } finally {
    server.close();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ home_location: HOME, current_location: null, timezone: 'America/Toronto' });
  reverseGeocode.mockResolvedValue('Montreal, Quebec, CA');
});

describe('GET /me/location', () => {
  it('hands back both points, because they answer different questions', async () => {
    getUser.mockResolvedValue({
      home_location: HOME,
      current_location: { ...DOWNTOWN, label: 'Montreal' },
      timezone: 'America/Toronto',
    });
    const r = await call('GET', '/me/location');
    expect(r.status).toBe(200);
    expect(r.body.home_location).toMatchObject({ lat: 45.4 });
    expect(r.body.current_location).toMatchObject({ lat: 45.5, label: 'Montreal' });
  });

  it('says null for "at home" rather than repeating the address', async () => {
    const r = await call('GET', '/me/location');
    expect(r.body.current_location).toBeNull();
  });
});

describe('POST /me/current-location', () => {
  it('names the place and stores it without touching home', async () => {
    const r = await call('POST', '/me/current-location', DOWNTOWN);
    expect(r.status).toBe(200);
    expect(reverseGeocode).toHaveBeenCalledWith(45.5, -73.57);
    expect(setCurrent).toHaveBeenCalledWith('u1', { ...DOWNTOWN, label: 'Montreal, Quebec, CA' });
    expect(setHome).not.toHaveBeenCalled(); // the whole point of A21
    expect(r.body.current_location).toMatchObject({ label: 'Montreal, Quebec, CA' });
  });

  it('stores the point anyway when the geocoder has no name for it', async () => {
    reverseGeocode.mockResolvedValue(null);
    const r = await call('POST', '/me/current-location', DOWNTOWN);
    expect(r.status).toBe(200);
    expect(setCurrent).toHaveBeenCalledWith('u1', DOWNTOWN);
  });

  it('refuses a typed city here — that is a statement about home', async () => {
    const r = await call('POST', '/me/current-location', { city: 'Montreal' });
    expect(r.status).toBe(400);
    expect(setCurrent).not.toHaveBeenCalled();
  });

  it('refuses coordinates that are not on the planet', async () => {
    expect((await call('POST', '/me/current-location', { lat: 145, lon: -73 })).status).toBe(400);
    expect(setCurrent).not.toHaveBeenCalled();
  });
});

describe('DELETE /me/current-location', () => {
  it('drops the transient and leaves home alone', async () => {
    const r = await call('DELETE', '/me/current-location');
    expect(r.status).toBe(200);
    expect(r.body.current_location).toBeNull();
    expect(clearCurrent).toHaveBeenCalledWith('u1');
    expect(clearHome).not.toHaveBeenCalled();
  });
});

describe('POST /me/location', () => {
  it('is still the only route that moves home — and it says the transient is gone', async () => {
    const r = await call('POST', '/me/location', { lat: 45.4, lon: -73.9, timezone: 'America/Toronto' });
    expect(r.status).toBe(200);
    expect(setHome).toHaveBeenCalledTimes(1);
    // The repo clears current_location in the same statement; the response tells the client so it
    // can drop its copy instead of drawing a city the server no longer believes in.
    expect(r.body.current_location).toBeNull();
  });
});
