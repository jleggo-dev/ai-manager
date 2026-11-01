/**
 * The weigh-in and the check-off against the REAL /plan routes — both sides at once (the shape and
 * the reason: src/test/client-route.ts). Written 2026-11-01 for two places a write showed the
 * wrong thing:
 *
 * - POST /plan/weigh-in answered 404 both for "no weigh-in on your plan" and for an implausible
 *   weight, so a typo like "5" was told to go and add a weight goal. And the number was checked
 *   only after today's occurrence had been created for it.
 * - setOccurrence never looked at the answer, so a check-off the server refused looked done.
 *
 * Faked: the occurrence and account repos behind the routes.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { serveRoutesToWebClient, type ClientAgainstRoutes } from '../test/client-route.ts';

const store: { hasWeighIn: boolean; down: boolean; createdToday: number; status: Record<string, string> } = {
  hasWeighIn: true,
  down: false,
  createdToday: 0,
  status: {},
};

vi.mock('../auth/middleware.ts', () => ({
  requireCadenceUser: (req: { cadenceUserId?: string }, _res: unknown, next: () => void) => {
    req.cadenceUserId = 'u1';
    next();
  },
}));
vi.mock('../repos/occurrences.ts', () => ({
  findWeighInActivity: async () => (store.hasWeighIn ? { activity_id: 'a-weigh' } : null),
  getOrInsertOccurrenceId: async () => {
    store.createdToday += 1;
    return 'o-today';
  },
  getOccurrenceWithActivity: async (_u: string, id: string) =>
    id === 'o-today' || id === 'o-weigh'
      ? { occurrence_id: id, kind: 'system', title: 'Weekly weigh-in', date: '2026-11-01', session: null }
      : { occurrence_id: id, kind: 'user', title: 'Evening ruck', date: '2026-11-01', session: null },
  recordOccurrenceLog: async () => true,
  setOccurrenceStatus: async (_u: string, id: string, status: string) => {
    if (store.down) throw new Error('connection terminated');
    store.status[id] = status;
  },
}));
vi.mock('../repos/users.ts', () => ({
  getUser: async () => ({ baseline: {} }),
  mergeBaseline: async () => {},
}));
vi.mock('../services/background.ts', () => ({ runInBackground: () => {} }));

interface WebOccurrenceApi {
  recordWeighIn(id: string, weight: number, unit: 'kg' | 'lb'): Promise<{ weight_kg: number }>;
  recordWeighInToday(weight: number, unit: 'kg' | 'lb'): Promise<{ weight_kg: number }>;
  isImplausibleWeight(err: unknown): boolean;
}
interface WebPlanApi {
  setOccurrence(id: string, status: 'pending' | 'done' | 'skipped'): Promise<void>;
}

const { default: planRoutes } = await import('./plan.ts');
let served: ClientAgainstRoutes<WebOccurrenceApi>;
let occurrence: WebOccurrenceApi;
let plan: WebPlanApi;

beforeAll(async () => {
  served = await serveRoutesToWebClient<WebOccurrenceApi>('occurrence.ts', (app) => {
    app.use('/plan', planRoutes);
  });
  occurrence = served.web;
  plan = await served.load<WebPlanApi>('plan.ts');
});
afterAll(() => served.close());

beforeEach(() => {
  store.hasWeighIn = true;
  store.down = false;
  store.createdToday = 0;
  store.status = {};
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

/** What the screens read off a refused weigh-in: the status, and whether it's the typo case. */
async function refusal(write: Promise<unknown>): Promise<{ status?: number; implausible: boolean }> {
  try {
    await write;
  } catch (e) {
    return { status: (e as { status?: number }).status, implausible: occurrence.isImplausibleWeight(e) };
  }
  throw new Error('expected the write to be refused');
}

describe("today's weight (WeighInSettings, the quick-add row) against POST /plan/weigh-in", () => {
  it('a plausible weight lands', async () => {
    expect(await occurrence.recordWeighInToday(195, 'lb')).toEqual({ weight_kg: 88.5 });
  });

  it('a typo like "5" is its own answer — not "no weigh-in on your plan"', async () => {
    expect(await refusal(occurrence.recordWeighInToday(5, 'kg'))).toEqual({ status: 422, implausible: true });
    expect(await refusal(occurrence.recordWeighInToday(900, 'kg'))).toEqual({ status: 422, implausible: true });
  });

  it('a refused weight leaves no occurrence behind for today', async () => {
    await refusal(occurrence.recordWeighInToday(5, 'kg'));
    expect(store.createdToday).toBe(0);
  });

  it('a plan with no weigh-in still answers 404, which the screen reads as "add a weight goal"', async () => {
    store.hasWeighIn = false;
    expect(await refusal(occurrence.recordWeighInToday(195, 'lb'))).toEqual({ status: 404, implausible: false });
  });
});

describe('the scheduled weigh-in (WeighInPanel) against POST /plan/occurrences/:id/weigh-in', () => {
  it('lands on the weigh-in row, and refuses a typo as a typo', async () => {
    expect(await occurrence.recordWeighIn('o-weigh', 88.4, 'kg')).toEqual({ weight_kg: 88.4 });
    expect(await refusal(occurrence.recordWeighIn('o-weigh', 5, 'kg'))).toEqual({ status: 422, implausible: true });
  });

  it('a row that is not a weigh-in is still a 404', async () => {
    expect(await refusal(occurrence.recordWeighIn('o-ruck', 88.4, 'kg'))).toEqual({ status: 404, implausible: false });
  });
});

describe('checking a task off (StartSheet, CookSheet) against POST /plan/occurrences/:id', () => {
  it('a check-off that lands resolves', async () => {
    await expect(plan.setOccurrence('o-ruck', 'done')).resolves.toBeUndefined();
    expect(store.status['o-ruck']).toBe('done');
  });

  it('a check-off the server refuses throws — it used to resolve, so it looked done', async () => {
    store.down = true;
    await expect(plan.setOccurrence('o-ruck', 'done')).rejects.toThrow(/500/);
    await expect(plan.setOccurrence('o-ruck', 'bogus' as 'done')).rejects.toThrow(/400/);
  });
});
