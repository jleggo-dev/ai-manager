/**
 * "Every time" against the REAL /plan/activity-how-to route — both sides at once
 * (src/test/client-route.ts). The contract: 200 with the instruction as it now reads, `kept`
 * saying whether this tap wrote it or it was already there; 422 is the bound, which the client
 * names `full`; 404 and a bad body are `failed`. Faked: the repos behind the service.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { serveRoutesToWebClient, type ClientAgainstRoutes } from '../test/client-route.ts';

const getOccurrenceWithActivity = vi.fn();
const getUserActivity = vi.fn();
const getActiveActivityForCommitment = vi.fn();
const updateActivityHowTo = vi.fn();
const clearFuturePendingSessions = vi.fn();

vi.mock('../auth/middleware.ts', () => ({
  requireCadenceUser: (req: { cadenceUserId?: string }, _res: unknown, next: () => void) => {
    req.cadenceUserId = 'u1';
    next();
  },
}));
vi.mock('../repos/occurrences.ts', () => ({
  getOccurrenceWithActivity: (...a: unknown[]) => getOccurrenceWithActivity(...a),
  clearFuturePendingSessions: (...a: unknown[]) => clearFuturePendingSessions(...a),
}));
vi.mock('../repos/activities.ts', () => ({
  getUserActivity: (...a: unknown[]) => getUserActivity(...a),
  getActiveActivityForCommitment: (...a: unknown[]) => getActiveActivityForCommitment(...a),
  updateActivityHowTo: (...a: unknown[]) => updateActivityHowTo(...a),
}));

interface WebHowToApi {
  keepHowTo(
    occurrenceId: string,
    sentence: string,
  ): Promise<{ ok: true; kept: boolean; how_to: string; activity: string } | { ok: false; reason: string }>;
}

const { default: routes } = await import('./plan-activity-how-to.ts');
let served: ClientAgainstRoutes<WebHowToApi>;

beforeAll(async () => {
  served = await serveRoutesToWebClient<WebHowToApi>('activity-how-to.ts', (app) => app.use('/plan', routes));
});
afterAll(() => served.close());
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  getOccurrenceWithActivity.mockResolvedValue({ occurrence_id: 'o1', activity_id: 'a1', date: '2026-11-02' });
  getUserActivity.mockResolvedValue({
    activity_id: 'a1',
    commitment_id: 'c1',
    title: 'Obstacle strength',
    how_to: null,
  });
  getActiveActivityForCommitment.mockResolvedValue({
    activity_id: 'a1',
    commitment_id: 'c1',
    title: 'Obstacle strength',
    how_to: null,
  });
  updateActivityHowTo.mockResolvedValue(true);
  clearFuturePendingSessions.mockResolvedValue(0);
});

describe('keepHowTo against POST /plan/activity-how-to', () => {
  it('writes the sentence once and hands back the instruction as it now reads', async () => {
    expect(await served.web.keepHowTo('o1', 'alternate bench press and dumbbell row')).toEqual({
      ok: true,
      kept: true,
      how_to: 'alternate bench press and dumbbell row',
      activity: 'Obstacle strength',
    });
    expect(updateActivityHowTo).toHaveBeenCalledTimes(1);
  });

  it('the same sentence again is kept:false, and nothing is written twice', async () => {
    getActiveActivityForCommitment.mockResolvedValue({
      activity_id: 'a1',
      commitment_id: 'c1',
      title: 'Obstacle strength',
      how_to: 'alternate bench press and dumbbell row',
    });
    expect(await served.web.keepHowTo('o1', 'alternate bench press and dumbbell row')).toEqual({
      ok: true,
      kept: false,
      how_to: 'alternate bench press and dumbbell row',
      activity: 'Obstacle strength',
    });
    expect(updateActivityHowTo).not.toHaveBeenCalled();
  });

  it('an instruction at its bound is full to the client', async () => {
    getActiveActivityForCommitment.mockResolvedValue({
      activity_id: 'a1',
      commitment_id: 'c1',
      title: 'x',
      how_to: 'x'.repeat(590),
    });
    expect(await served.web.keepHowTo('o1', 'alternate bench press and dumbbell row')).toEqual({
      ok: false,
      reason: 'full',
    });
    expect(updateActivityHowTo).not.toHaveBeenCalled();
  });

  it('a session that is not this user’s is failed, and nothing is written', async () => {
    getOccurrenceWithActivity.mockResolvedValue(null);
    expect(await served.web.keepHowTo('o1', 'dead hang one set at a time')).toEqual({ ok: false, reason: 'failed' });
    expect(updateActivityHowTo).not.toHaveBeenCalled();
  });

  it('an empty sentence is refused before anything is read', async () => {
    expect(await served.web.keepHowTo('o1', '   ')).toEqual({ ok: false, reason: 'failed' });
    expect(getOccurrenceWithActivity).not.toHaveBeenCalled();
  });
});
