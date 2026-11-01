/**
 * The constraint rename/remove calls against the REAL /me routes — both sides at once (the shape
 * and the reason: src/test/client-route.ts). Removing one that was already gone answered 404, so a
 * second tap read as a failure (null) when the list it asked for was already true. Both calls hand
 * back the list as it stands, so the screen never guesses at the new state.
 *
 * Faked: the account row, and the services /me pulls in that these routes never touch.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { serveRoutesToWebClient, type ClientAgainstRoutes } from '../test/client-route.ts';

type Constraint = { id: string; label: string };
const account: { constraints: Constraint[]; storeDown: boolean } = { constraints: [], storeDown: false };

vi.mock('../auth/middleware.ts', () => ({
  requireCadenceUser: (req: { cadenceUserId?: string }, _res: unknown, next: () => void) => {
    req.cadenceUserId = 'u1';
    next();
  },
}));
vi.mock('../repos/users.ts', () => ({
  getUser: async () => ({ baseline: { constraints: account.constraints.map((c) => ({ ...c })) } }),
  mergeBaseline: async (_u: string, patch: { constraints: Constraint[] }) => {
    if (account.storeDown) throw new Error('connection terminated');
    account.constraints = patch.constraints;
  },
  clearCurrentLocation: async () => {},
  clearHomeLocation: async () => {},
  mergeUnitPrefs: async () => {},
  setCurrentLocation: async () => {},
  setHomeLocation: async () => {},
}));
vi.mock('../services/dev-reset.ts', () => ({ resetUserData: async () => {} }));
vi.mock('../services/dev-trace.ts', () => ({ clearTrace: () => {} }));
vi.mock('../ai/aim.ts', () => ({ AimError: class extends Error {}, purgeUserAiData: async () => {} }));
vi.mock('../services/weather/weather.ts', () => ({
  geocodeCity: async () => null,
  reverseGeocode: async () => null,
  getWeatherWhereYouAre: async () => null,
  needsAppleAttribution: () => false,
  APPLE_WEATHER_ATTRIBUTION_URL: '',
}));
vi.mock('../services/weather/forecast-ahead.ts', () => ({ getForecastWhereYouAre: async () => null }));
vi.mock('../services/day-recap.ts', () => ({ getDayRecap: async () => null }));
vi.mock('../services/now-menu.ts', () => ({ getNowMenu: async () => null }));

/** The slice of the web client's lib/api/me.ts that edits constraints. */
interface WebMeApi {
  getConstraints(): Promise<Constraint[]>;
  renameConstraint(id: string, label: string): Promise<Constraint[] | null>;
  removeConstraint(id: string): Promise<Constraint[] | null>;
}

const { default: meRoutes } = await import('./me.ts');
let served: ClientAgainstRoutes<WebMeApi>;
let web: WebMeApi;

beforeAll(async () => {
  served = await serveRoutesToWebClient<WebMeApi>('me.ts', (app) => app.use('/me', meRoutes));
  web = served.web;
});
afterAll(() => served.close());

beforeEach(() => {
  account.constraints = [
    { id: 'c1', label: 'Sore left elbow' },
    { id: 'c2', label: 'No gym on Sundays' },
  ];
  account.storeDown = false;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('removing a constraint against DELETE /me/constraints/:id', () => {
  it('a remove that lands hands back the list without it', async () => {
    expect(await web.removeConstraint('c1')).toEqual([{ id: 'c2', label: 'No gym on Sundays' }]);
    expect(await web.getConstraints()).toEqual([{ id: 'c2', label: 'No gym on Sundays' }]);
  });

  it('a second tap on the same one reads as done, with the same list — not as a failure', async () => {
    await web.removeConstraint('c1');
    expect(await web.removeConstraint('c1')).toEqual([{ id: 'c2', label: 'No gym on Sundays' }]);
  });

  it('a store that fails reads as failed (null), and the list is unchanged', async () => {
    account.storeDown = true;
    expect(await web.removeConstraint('c1')).toBeNull();
    expect(account.constraints).toHaveLength(2);
  });
});

describe('renaming a constraint against PATCH /me/constraints/:id', () => {
  it('a rename that lands hands back the renamed list; one that is gone reads as failed', async () => {
    expect(await web.renameConstraint('c1', 'Left elbow')).toContainEqual({ id: 'c1', label: 'Left elbow' });
    expect(await web.renameConstraint('nope', 'x')).toBeNull();
  });
});
