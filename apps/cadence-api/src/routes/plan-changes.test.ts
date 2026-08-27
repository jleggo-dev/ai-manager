/**
 * The Changes sheet's own routes: the toggle-persistence POST, and the detail GET it reads back
 * from before applying. Same express-on-an-ephemeral-port harness week-review.test.ts uses. No
 * clearMocks in vitest config, so every mock gets a fresh default in `beforeEach` rather than
 * relying on call-count resets.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import type { PendingPlan } from '@cadence/shared';

const getUser = vi.fn();
const setPendingPlan = vi.fn(async (..._a: unknown[]) => {});
const buildPendingChangeDetail = vi.fn();

vi.mock('../repos/users.ts', () => ({
  getUser: (...a: unknown[]) => getUser(...a),
  setPendingPlan: (...a: unknown[]) => setPendingPlan(...a),
}));
vi.mock('../services/plan-change-detail.ts', () => ({
  buildPendingChangeDetail: (...a: unknown[]) => buildPendingChangeDetail(...a),
}));
vi.mock('../auth/middleware.ts', () => ({
  requireCadenceUser: (req: { cadenceUserId?: string }, _res: unknown, next: () => void) => {
    req.cadenceUserId = 'u1';
    next();
  },
}));

const { default: planChangesRoutes } = await import('./plan-changes.ts');

function pendingPlan(): PendingPlan {
  return {
    activities: [
      {
        title: 'Easy run',
        kind: 'user',
        cadence: 'Thu',
        recurrence: 'FREQ=WEEKLY;BYDAY=TH',
        completion_source: 'self_report',
      },
      {
        title: 'Sauna',
        kind: 'user',
        cadence: 'Sun',
        recurrence: 'FREQ=WEEKLY;BYDAY=SU',
        completion_source: 'self_report',
        enabled: false,
      },
    ],
    note: 'n',
    goal_ids: [],
    created_at: '2026-08-26T09:00:00.000Z',
  };
}

interface RouteResponse {
  status: number;
  body: Record<string, unknown>;
}

async function call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<RouteResponse> {
  const app = express();
  app.use(express.json());
  app.use('/plan', planChangesRoutes);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown> };
  } finally {
    server.close();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ pending_plan: pendingPlan() });
  buildPendingChangeDetail.mockResolvedValue({ plan_version: 4, items: [] });
});

describe('POST /plan/pending-change/toggles', () => {
  it('flips enabled on the named rows, by their stored array position, and persists the whole plan back', async () => {
    const r = await call('POST', '/plan/pending-change/toggles', {
      toggles: [
        { index: 0, enabled: false },
        { index: 1, enabled: true },
      ],
    });

    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
    expect(setPendingPlan).toHaveBeenCalledTimes(1);
    const [userId, saved] = setPendingPlan.mock.calls[0] as [string, PendingPlan];
    expect(userId).toBe('u1');
    expect(saved.activities[0]!.enabled).toBe(false);
    expect(saved.activities[1]!.enabled).toBe(true);
  });

  it('leaves every other row exactly as it was', async () => {
    await call('POST', '/plan/pending-change/toggles', { toggles: [{ index: 1, enabled: true }] });
    const [, saved] = setPendingPlan.mock.calls[0] as [string, PendingPlan];
    expect(saved.activities[0]!.title).toBe('Easy run');
    expect(saved.activities[0]!.enabled).toBeUndefined(); // untouched — never defaulted to true
  });

  it('409s with nothing pending to toggle, and never calls setPendingPlan', async () => {
    getUser.mockResolvedValue({ pending_plan: null });
    const r = await call('POST', '/plan/pending-change/toggles', { toggles: [{ index: 0, enabled: false }] });
    expect(r.status).toBe(409);
    expect(setPendingPlan).not.toHaveBeenCalled();
  });

  it('400s on an index past the end of the stored array, and never calls setPendingPlan', async () => {
    const r = await call('POST', '/plan/pending-change/toggles', { toggles: [{ index: 7, enabled: false }] });
    expect(r.status).toBe(400);
    expect(String(r.body.error)).toMatch(/out of range/);
    expect(setPendingPlan).not.toHaveBeenCalled();
  });

  it('400s on a negative index — invalid input, not a valid position', async () => {
    const r = await call('POST', '/plan/pending-change/toggles', { toggles: [{ index: -1, enabled: false }] });
    expect(r.status).toBe(400);
    expect(setPendingPlan).not.toHaveBeenCalled();
  });

  it('400s on an empty toggles list rather than silently doing nothing', async () => {
    const r = await call('POST', '/plan/pending-change/toggles', { toggles: [] });
    expect(r.status).toBe(400);
  });

  it('reports a storage failure instead of pretending it saved', async () => {
    setPendingPlan.mockRejectedValueOnce(new Error('db down'));
    const r = await call('POST', '/plan/pending-change/toggles', { toggles: [{ index: 0, enabled: false }] });
    expect(r.status).toBe(500);
  });
});

describe('GET /plan/pending-change/detail', () => {
  it("returns the service's own composition untouched", async () => {
    buildPendingChangeDetail.mockResolvedValue({
      plan_version: 4,
      items: [{ index: 0, title: 'Easy run', enabled: true, now: 'Thu · 6:30 pm', next: 'Fri · 6:15 am' }],
    });
    const r = await call('GET', '/plan/pending-change/detail');
    expect(r.status).toBe(200);
    expect(buildPendingChangeDetail).toHaveBeenCalledWith('u1');
    expect(r.body.plan_version).toBe(4);
    expect(r.body.items).toHaveLength(1);
  });

  it('reports a failure instead of a half-built list', async () => {
    buildPendingChangeDetail.mockRejectedValueOnce(new Error('db down'));
    const r = await call('GET', '/plan/pending-change/detail');
    expect(r.status).toBe(500);
  });
});
