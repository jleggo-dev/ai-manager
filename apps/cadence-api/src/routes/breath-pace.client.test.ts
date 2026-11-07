/**
 * The pace slider's save and load against the REAL route, both sides at once (the shape and the
 * reason: src/test/client-route.ts). The card's own tests fake this client and the route's tests
 * fake the phone, so a disagreement between them is invisible to both, and here it would be silent
 * on the phone too: the card keeps playing the phone's copy, the account never hears, and the only
 * symptom is a new phone that has forgotten.
 *
 * Faked: the row behind the route.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BREATH_PATTERNS, MAX_BREATH_PACE, MIN_BREATH_PACE, breathPaceCeiling, breathPaceFloor } from '@cadence/shared';
import { serveRoutesToWebClient, type ClientAgainstRoutes } from '../test/client-route.ts';

const account: { pace: number | null; storeDown: boolean } = { pace: null, storeDown: false };

function store() {
  if (account.storeDown) throw new Error('connection terminated');
}

vi.mock('../auth/middleware.ts', () => ({
  requireCadenceUser: (req: { cadenceUserId?: string }, _res: unknown, next: () => void) => {
    req.cadenceUserId = 'u1';
    next();
  },
}));
vi.mock('../repos/breath-pace.ts', () => ({
  getBreathPace: async () => {
    store();
    return account.pace;
  },
  setBreathPace: async (_u: string, pace: number) => {
    store();
    account.pace = pace;
  },
}));

interface WebBreathPaceApi {
  getBreathPace(): Promise<number | null>;
  saveBreathPace(pace: number): Promise<boolean>;
}

const { default: breathPaceRoutes } = await import('./breath-pace.ts');
let served: ClientAgainstRoutes<WebBreathPaceApi>;
let web: WebBreathPaceApi;

beforeAll(async () => {
  served = await serveRoutesToWebClient<WebBreathPaceApi>('breath-pace.ts', (app) => {
    app.use('/me', breathPaceRoutes);
  });
  web = served.web;
});
afterAll(() => served.close());

beforeEach(() => {
  account.pace = null;
  account.storeDown = false;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('breath pace, client against route', () => {
  it('an account that never set a pace reads as null, not as a pace', async () => {
    expect(await web.getBreathPace()).toBeNull();
  });

  it.each([[MIN_BREATH_PACE], [1], [1.37], [MAX_BREATH_PACE]])(
    '%f saves and reads back as the same number',
    async (pace) => {
      expect(await web.saveBreathPace(pace)).toBe(true);
      expect(account.pace).toBe(pace);
      expect(await web.getBreathPace()).toBe(pace);
    },
  );

  it('every value the slider can produce on any pattern is one the route accepts', async () => {
    for (const pattern of BREATH_PATTERNS) {
      for (const cycles of [1, 6, 37]) {
        for (const pace of [breathPaceFloor(pattern), breathPaceCeiling(pattern, cycles)]) {
          expect(await web.saveBreathPace(pace), `${pattern.id} × ${cycles} at ${pace}`).toBe(true);
        }
      }
    }
  });

  it.each([[0.5], [3]])('%f is refused, reported as not saved, and the record stands', async (pace) => {
    account.pace = 1.2;
    expect(await web.saveBreathPace(pace)).toBe(false);
    expect(account.pace).toBe(1.2);
  });

  it('a store that is down costs the sync and nothing else: neither side throws', async () => {
    account.storeDown = true;
    await expect(web.getBreathPace()).resolves.toBeNull();
    await expect(web.saveBreathPace(1.5)).resolves.toBe(false);
  });
});
