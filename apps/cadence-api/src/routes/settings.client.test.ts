/**
 * Two Settings switches against the REAL routes they call — both sides at once (the shape and the
 * reason: src/test/client-route.ts). Both were live disagreements when this file was written
 * (2026-11-01), found by the audit that followed the change-buttons bug:
 *
 * - Progress photos: PUT /progress/photos/enabled answers what it stored, `{enabled: false}` after
 *   a switch-off, and the client read only `enabled === true` as saved. Turning photos off saved,
 *   then the row flipped back on and said "That didn't save".
 * - The weigh-in choice and the other review writes: the client never looked at the status, so a
 *   refused save looked saved until the next reload.
 *
 * Faked: the account row and the repos behind /review.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { serveRoutesToWebClient, type ClientAgainstRoutes } from '../test/client-route.ts';

const account: { progress_photos_enabled: boolean; baseline: Record<string, unknown>; storeDown: boolean } = {
  progress_photos_enabled: false,
  baseline: {},
  storeDown: false,
};
function store() {
  if (account.storeDown) throw new Error('connection terminated');
}

vi.mock('../auth/middleware.ts', () => ({
  requireCadenceUser: (req: { cadenceUserId?: string }, _res: unknown, next: () => void) => {
    req.cadenceUserId = 'u1';
    next();
  },
}));
vi.mock('../repos/users.ts', () => ({
  getUser: async () => ({ ...account }),
  setProgressPhotosEnabled: async (_u: string, enabled: boolean) => {
    store();
    account.progress_photos_enabled = enabled;
  },
  mergeBaseline: async (_u: string, patch: Record<string, unknown>) => {
    store();
    Object.assign(account.baseline, patch);
  },
  setName: async () => store(),
}));
vi.mock('../services/progress-photos.ts', () => ({
  getPhotoPair: async () => ({ reason: 'none' }),
  listProgressPhotoCards: async () => ({ enabled: account.progress_photos_enabled, count: 0, next_due: null }),
  putProgressPhoto: async () => null,
}));
vi.mock('../repos/goals.ts', () => ({
  listGoalsByStatus: async () => [],
  setGoalStatus: async () => {},
  insertGoal: async () => null,
  updateGoal: async () => store(),
  deleteGoal: async () => store(),
  retireGoal: async () => null,
  restoreGoal: async () => null,
}));
vi.mock('../repos/equipment.ts', () => ({
  listEquipment: async () => [],
  insertEquipment: async () => null,
  updateEquipment: async () => store(),
  deleteEquipment: async () => store(),
}));
vi.mock('../services/goal-guardrail.ts', () => ({ evaluateGuardrail: () => ({ ok: true }) }));
vi.mock('../services/goal-assess.ts', () => ({ assessGoal: async () => null }));

interface WebPhotosApi {
  setProgressPhotosEnabled(enabled: boolean): Promise<boolean>;
  getProgressPhotosStatus(): Promise<{ enabled: boolean }>;
}
interface WebReviewApi {
  updateBaseline(patch: Record<string, unknown>): Promise<void>;
  updateName(name: string): Promise<void>;
  updateGoal(goalId: string, fields: Record<string, unknown>): Promise<void>;
  deleteGoal(goalId: string): Promise<void>;
  updateEquipment(id: string, fields: Record<string, unknown>): Promise<void>;
  deleteEquipmentItem(id: string): Promise<void>;
}

const { default: progressPhotosRoutes } = await import('./progress-photos.ts');
const { default: reviewRoutes } = await import('./review.ts');
let served: ClientAgainstRoutes<WebPhotosApi>;
let photos: WebPhotosApi;
let review: WebReviewApi;

beforeAll(async () => {
  served = await serveRoutesToWebClient<WebPhotosApi>('progress-photos.ts', (app) => {
    app.use('/review', reviewRoutes);
    app.use('/progress', progressPhotosRoutes);
  });
  photos = served.web;
  review = await served.load<WebReviewApi>('review.ts');
});
afterAll(() => served.close());

beforeEach(() => {
  account.progress_photos_enabled = false;
  account.baseline = {};
  account.storeDown = false;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('the progress photos switch (SettingsProgressPhotos) against PUT /progress/photos/enabled', () => {
  it('turning photos on that saves reads as saved', async () => {
    expect(await photos.setProgressPhotosEnabled(true)).toBe(true);
    expect((await photos.getProgressPhotosStatus()).enabled).toBe(true);
  });

  it('turning photos OFF that saves reads as saved — the bug was this reading as a failed save', async () => {
    account.progress_photos_enabled = true;
    expect(await photos.setProgressPhotosEnabled(false)).toBe(true);
    expect((await photos.getProgressPhotosStatus()).enabled).toBe(false);
  });

  it('a save that fails reads as failed, either way', async () => {
    account.storeDown = true;
    expect(await photos.setProgressPhotosEnabled(true)).toBe(false);
    expect(await photos.setProgressPhotosEnabled(false)).toBe(false);
  });
});

describe('the review writes (WeighInSettings, SettingsTools) against /review', () => {
  it('a weigh-in choice that saves resolves, and lands', async () => {
    await expect(review.updateBaseline({ weigh_in_cadence: 'daily' })).resolves.toBeUndefined();
    expect(account.baseline.weigh_in_cadence).toBe('daily');
  });

  it('a weigh-in choice the route refuses throws — that is what puts "That didn\'t save" on screen', async () => {
    await expect(review.updateBaseline({ weigh_in_cadence: 'hourly' })).rejects.toThrow(/400/);
    account.storeDown = true;
    await expect(review.updateBaseline({ weigh_in_cadence: 'weekly' })).rejects.toThrow(/500/);
  });

  it('the other review writes resolve when they land and throw when the store fails', async () => {
    const writes = [
      () => review.updateName('Sam'),
      () => review.updateGoal('g1', { title: 'Run a 10k' }),
      () => review.deleteGoal('g1'),
      () => review.updateEquipment('e1', { name: 'Kettlebell' }),
      () => review.deleteEquipmentItem('e1'),
    ];
    for (const write of writes) await expect(write()).resolves.toBeUndefined();
    account.storeDown = true;
    for (const write of writes) await expect(write()).rejects.toThrow(/500/);
  });
});
