/**
 * `GET /me/recaps` (Progress Engine W2-1) — the `recap_rail` widget's data. Same
 * express-on-an-ephemeral-port harness week-review.test.ts uses. `repos/recaps.ts` is mocked, so
 * this never touches `cadence.recaps` — the 0046 migration is not applied anywhere this suite runs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';

const listRecaps = vi.fn();

vi.mock('../repos/recaps.ts', () => ({ listRecaps: (...a: unknown[]) => listRecaps(...a) }));
vi.mock('../auth/middleware.ts', () => ({
  requireCadenceUser: (req: { cadenceUserId?: string }, _res: unknown, next: () => void) => {
    req.cadenceUserId = 'u1';
    next();
  },
}));

const { default: recapsRoutes } = await import('./recaps.ts');

const ROW = {
  id: 'r1',
  user_id: 'u1',
  week_start: '2026-08-17',
  facts: { sessions: { kept: 4, scheduled: 5 }, meals: { logged: 19, total: 21 }, weigh_in: null },
  facts_line: 'showed up 4 of 5 · 19 of 21 meals',
  line: null,
  detour: false,
  created_at: '2026-08-24T09:00:00.000Z',
};

interface RouteResponse {
  status: number;
  body: Record<string, unknown>;
}

async function get(query = ''): Promise<RouteResponse> {
  const app = express();
  app.use('/me', recapsRoutes);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/me/recaps${query}`);
    return { status: res.status, body: ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown> };
  } finally {
    server.close();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  listRecaps.mockResolvedValue([ROW]);
});

describe('GET /me/recaps', () => {
  it('maps rows to week_start/facts_line/line/detour, defaulting the limit', async () => {
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      recaps: [{ week_start: '2026-08-17', facts_line: ROW.facts_line, line: null, detour: false }],
    });
    expect(listRecaps).toHaveBeenCalledWith('u1', 8);
  });

  it('passes a valid ?limit= through, clamped to the max', async () => {
    await get('?limit=3');
    expect(listRecaps).toHaveBeenCalledWith('u1', 3);

    await get('?limit=9999');
    expect(listRecaps).toHaveBeenCalledWith('u1', 50);
  });

  it('falls back to the default limit on garbage input rather than erroring', async () => {
    await get('?limit=not-a-number');
    expect(listRecaps).toHaveBeenCalledWith('u1', 8);
  });

  it('returns an empty rail rather than an error when there are no recaps yet', async () => {
    listRecaps.mockResolvedValue([]);
    const r = await get();
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ recaps: [] });
  });

  it('500s without crashing when the repo throws', async () => {
    listRecaps.mockRejectedValue(new Error('db down'));
    const r = await get();
    expect(r.status).toBe(500);
  });
});
