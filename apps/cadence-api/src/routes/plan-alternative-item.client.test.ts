/**
 * "Something else" against the REAL /plan/alternative-item route — both sides at once
 * (src/test/client-route.ts). The contract: one alternative in the normalizer's shape on 200; a
 * budget that runs out or an unusable answer is 503, which the client names `unreachable` so the
 * row can say "Couldn't reach the coach — try again"; an unparseable body is a plain `failed`.
 * Faked: the job runner, the equipment and user repos, the history read, the ai_log write.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { serveRoutesToWebClient, type ClientAgainstRoutes } from '../test/client-route.ts';

const job = vi.fn();
const logged: unknown[] = [];

vi.mock('../auth/middleware.ts', () => ({
  requireCadenceUser: (req: { cadenceUserId?: string }, _res: unknown, next: () => void) => {
    req.cadenceUserId = 'u1';
    next();
  },
}));
vi.mock('../ai/aim.ts', () => ({ runJobBySlug: (...a: unknown[]) => job(...a) }));
vi.mock('../repos/equipment.ts', () => ({
  listEquipment: async () => [{ name: 'kettlebell 40 lb', category: 'weights' }],
}));
vi.mock('../repos/users.ts', () => ({
  getUser: async () => ({ baseline: { constraints: [{ id: 'c1', label: 'left knee', plan_around: true }] } }),
}));
vi.mock('../repos/occurrence-logs.ts', () => ({
  listLoggedOccurrences: async () => [
    {
      date: '2026-10-28',
      title: 'Obstacle strength',
      log: { items: [{ name: 'glute bridge', done: true, sets: 2, reps: 12 }] },
    },
  ],
}));
vi.mock('../services/ai-log.ts', () => ({ logAi: async (_u: string, row: unknown) => void logged.push(row) }));

interface WebAlternativeApi {
  askAlternativeItem(ask: {
    activity?: string;
    item: { name: string; sets?: number; reps?: number; load?: string };
    alreadyOffered?: string[];
  }): Promise<{ ok: true; alternative: Record<string, unknown> } | { ok: false; reason: string }>;
}

const { default: routes } = await import('./plan-alternative-item.ts');
const { ALTERNATIVE_BUDGET_MS } = await import('../services/alternative-item.ts');
let served: ClientAgainstRoutes<WebAlternativeApi>;

beforeAll(async () => {
  served = await serveRoutesToWebClient<WebAlternativeApi>('alternative-item.ts', (app) => app.use('/plan', routes));
});
afterAll(() => served.close());
beforeEach(() => {
  job.mockReset();
  logged.length = 0;
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const bridge = { name: 'Glute bridge', sets: 2, reps: 12, load: 'bodyweight' };
const answer = (o: unknown) => ({ formatted: JSON.stringify(o) });

describe('askAlternativeItem against POST /plan/alternative-item', () => {
  it('hands the item, what was already offered, the equipment, the constraints and the logs to the job, and returns her one alternative', async () => {
    job.mockResolvedValue(
      answer({
        alternative: {
          name: 'Kettlebell hip thrust',
          sets: 2,
          reps: 12,
          load: '40 lb',
          detail: 'Shoulders on the bench.',
          video_query: 'kettlebell hip thrust form',
          equipment: ['Bench', 'kettlebell'],
          reason: 'never kept',
        },
      }),
    );
    const r = await served.web.askAlternativeItem({
      activity: 'Obstacle strength',
      item: bridge,
      alreadyOffered: ['Single-leg glute bridge'],
    });
    expect(r).toEqual({
      ok: true,
      alternative: {
        name: 'Kettlebell hip thrust',
        sets: 2,
        reps: 12,
        load: '40 lb',
        detail: 'Shoulders on the bench.',
        video_query: 'kettlebell hip thrust form',
        equipment: ['Bench', 'kettlebell'],
      },
    });
    const [, slug, vars] = job.mock.calls[0]! as [string, string, Record<string, string>];
    expect(slug).toBe('alternative-item');
    expect(vars.activity).toBe('Obstacle strength');
    expect(JSON.parse(vars.item!)).toEqual(bridge);
    expect(JSON.parse(vars.already_offered!)).toEqual(['Single-leg glute bridge']);
    expect(JSON.parse(vars.equipment!)).toEqual([{ name: 'kettlebell 40 lb', category: 'weights' }]);
    expect(JSON.parse(vars.constraints!)).toEqual([{ label: 'left knee', plan_around: true }]);
    expect(vars.recent_logs).toBe('- 2026-10-28: 2 sets, 12 reps');
    expect(logged).toEqual([
      expect.objectContaining({ kind: 'alternative_item', meta: expect.objectContaining({ status: 'ok' }) }),
    ]);
  });

  it('an answer with no name is unreachable to the sheet, and logged as unusable', async () => {
    job.mockResolvedValue(answer({ alternative: { reps: 10 } }));
    expect(await served.web.askAlternativeItem({ item: bridge })).toEqual({ ok: false, reason: 'unreachable' });
    expect(logged).toEqual([expect.objectContaining({ meta: expect.objectContaining({ status: 'unusable' }) })]);
  });

  it('a job that fails is unreachable, with the error in the log row', async () => {
    job.mockRejectedValue(new Error('provider 502'));
    expect(await served.web.askAlternativeItem({ item: bridge })).toEqual({ ok: false, reason: 'unreachable' });
    expect(logged).toEqual([
      expect.objectContaining({ meta: expect.objectContaining({ status: 'unreachable', error: 'provider 502' }) }),
    ]);
  });

  it('an item with no name is refused before any job runs', async () => {
    expect(await served.web.askAlternativeItem({ item: { name: '' } })).toEqual({ ok: false, reason: 'failed' });
    expect(job).not.toHaveBeenCalled();
  });

  it('the budget is 25 seconds', () => {
    expect(ALTERNATIVE_BUDGET_MS).toBe(25_000);
  });
});
