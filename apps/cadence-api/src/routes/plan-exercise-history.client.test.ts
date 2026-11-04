/**
 * The Change sheet's history rows against the REAL /plan/exercise-history route — both sides at
 * once (src/test/client-route.ts). The contract: an exercise name is required, the answer is
 * `{ lines }` newest first, and a server fault reaches the client as `ok: false`, never as an
 * empty list that would draw New over real history.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { serveRoutesToWebClient, type ClientAgainstRoutes } from '../test/client-route.ts';

const store = { down: false, rows: [] as Array<{ date: string; title: string; log: { items: unknown[] } }> };

vi.mock('../auth/middleware.ts', () => ({
  requireCadenceUser: (req: { cadenceUserId?: string }, _res: unknown, next: () => void) => {
    req.cadenceUserId = 'u1';
    next();
  },
}));
vi.mock('../repos/occurrence-logs.ts', () => ({
  listLoggedOccurrences: async (_u: string, opts: { title?: string }) => {
    if (store.down) throw new Error('connection terminated');
    return store.rows.filter((r) => !opts.title || r.title.toLowerCase() === opts.title.toLowerCase());
  },
}));

interface WebHistoryApi {
  getExerciseHistory(opts: {
    exercise: string;
    activity?: string;
    limit?: number;
  }): Promise<{ ok: true; lines: Array<Record<string, unknown>> } | { ok: false }>;
}

const { default: routes } = await import('./plan-exercise-history.ts');
let served: ClientAgainstRoutes<WebHistoryApi>;

beforeAll(async () => {
  served = await serveRoutesToWebClient<WebHistoryApi>('exercise-history.ts', (app) => app.use('/plan', routes));
});
afterAll(() => served.close());
beforeEach(() => {
  store.down = false;
  store.rows = [
    {
      date: '2026-10-28',
      title: 'Obstacle strength',
      log: { items: [{ name: 'kettlebell hip thrust', done: true, sets: 3, reps: 10, load: '25 lb' }] },
    },
    {
      date: '2026-10-21',
      title: 'Legs',
      log: { items: [{ name: 'Kettlebell hip thrust', done: true, sets: 2, reps: 10 }] },
    },
  ];
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('getExerciseHistory against GET /plan/exercise-history', () => {
  it('hands back the lines newest first, across activities when none is named', async () => {
    const r = await served.web.getExerciseHistory({ exercise: 'Kettlebell hip thrust' });
    expect(r).toEqual({
      ok: true,
      lines: [
        {
          date: '2026-10-28',
          activity: 'Obstacle strength',
          name: 'kettlebell hip thrust',
          sets: 3,
          reps: 10,
          load: '25 lb',
        },
        { date: '2026-10-21', activity: 'Legs', name: 'Kettlebell hip thrust', sets: 2, reps: 10 },
      ],
    });
  });

  it('narrows to the activity the sheet is in, and honours the limit', async () => {
    const r = await served.web.getExerciseHistory({ exercise: 'kettlebell hip thrust', activity: 'Legs', limit: 1 });
    expect(r).toEqual({ ok: true, lines: [expect.objectContaining({ activity: 'Legs' })] });
  });

  it('nothing on file is an empty list — that is New', async () => {
    expect(await served.web.getExerciseHistory({ exercise: 'banded clamshell' })).toEqual({ ok: true, lines: [] });
  });

  it('a server fault is ok:false, never an empty list', async () => {
    store.down = true;
    expect(await served.web.getExerciseHistory({ exercise: 'kettlebell hip thrust' })).toEqual({ ok: false });
  });
});
