/**
 * Route validation tests for the Settings Room SR-1 goal endpoints: rename (PATCH, pre-existing —
 * verified it still works), retire, and restore. Same express-on-an-ephemeral-port harness
 * week-review.test.ts uses. No clearMocks in vitest config, so every mock gets a fresh default in
 * `beforeEach` rather than relying on call-count resets.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';

const listGoalsByStatus = vi.fn();
const setGoalStatus = vi.fn();
const insertGoal = vi.fn();
const updateGoal = vi.fn(async (..._a: unknown[]) => {});
const deleteGoal = vi.fn(async (..._a: unknown[]) => {});
const retireGoal = vi.fn();
const restoreGoal = vi.fn();
const listEquipment = vi.fn();
const insertEquipment = vi.fn();
const updateEquipment = vi.fn(async (..._a: unknown[]) => {});
const deleteEquipment = vi.fn(async (..._a: unknown[]) => {});
const getUser = vi.fn();
const mergeBaseline = vi.fn(async (..._a: unknown[]) => {});
const setName = vi.fn(async (..._a: unknown[]) => {});
const evaluateGuardrail = vi.fn();
const assessGoal = vi.fn();

vi.mock('../repos/goals.ts', () => ({
  listGoalsByStatus: (...a: unknown[]) => listGoalsByStatus(...a),
  setGoalStatus: (...a: unknown[]) => setGoalStatus(...a),
  insertGoal: (...a: unknown[]) => insertGoal(...a),
  updateGoal: (...a: unknown[]) => updateGoal(...a),
  deleteGoal: (...a: unknown[]) => deleteGoal(...a),
  retireGoal: (...a: unknown[]) => retireGoal(...a),
  restoreGoal: (...a: unknown[]) => restoreGoal(...a),
}));
vi.mock('../repos/equipment.ts', () => ({
  listEquipment: (...a: unknown[]) => listEquipment(...a),
  insertEquipment: (...a: unknown[]) => insertEquipment(...a),
  updateEquipment: (...a: unknown[]) => updateEquipment(...a),
  deleteEquipment: (...a: unknown[]) => deleteEquipment(...a),
}));
vi.mock('../repos/users.ts', () => ({
  getUser: (...a: unknown[]) => getUser(...a),
  mergeBaseline: (...a: unknown[]) => mergeBaseline(...a),
  setName: (...a: unknown[]) => setName(...a),
}));
vi.mock('../services/goal-guardrail.ts', () => ({
  evaluateGuardrail: (...a: unknown[]) => evaluateGuardrail(...a),
}));
vi.mock('../services/goal-assess.ts', () => ({
  assessGoal: (...a: unknown[]) => assessGoal(...a),
}));
vi.mock('../auth/middleware.ts', () => ({
  requireCadenceUser: (req: { cadenceUserId?: string }, _res: unknown, next: () => void) => {
    req.cadenceUserId = 'u1';
    next();
  },
}));

const { default: reviewRoutes } = await import('./review.ts');

interface RouteResponse {
  status: number;
  body: Record<string, unknown>;
}

async function call(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string,
  body?: Record<string, unknown>,
): Promise<RouteResponse> {
  const app = express();
  app.use(express.json());
  app.use('/review', reviewRoutes);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown> };
  } finally {
    server.close();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PATCH /review/goals/:id (rename)', () => {
  it('accepts a title change — rename pre-existed this parcel and still works', async () => {
    const r = await call('PATCH', '/review/goals/g1', { title: 'New name' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
    expect(updateGoal).toHaveBeenCalledWith('u1', 'g1', expect.objectContaining({ title: 'New name' }));
  });

  it('500s and reports failure when the repo throws', async () => {
    updateGoal.mockRejectedValueOnce(new Error('db down'));
    const r = await call('PATCH', '/review/goals/g1', { title: 'New name' });
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ error: 'update failed' });
  });
});

describe('POST /review/goals/:id/retire', () => {
  it('retires the goal and returns it', async () => {
    const parked = { goal_id: 'g1', title: 'Obstacle race', status: 'parked', prior_status: 'committed' };
    retireGoal.mockResolvedValue(parked);
    const r = await call('POST', '/review/goals/g1/retire');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, goal: parked });
    expect(retireGoal).toHaveBeenCalledWith('u1', 'g1');
  });

  it("404s when there is nothing to retire (already parked, or not this user's goal)", async () => {
    retireGoal.mockResolvedValue(null);
    const r = await call('POST', '/review/goals/g1/retire');
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: 'goal not found or already retired' });
  });

  it('500s and reports failure when the repo throws', async () => {
    retireGoal.mockRejectedValue(new Error('db down'));
    const r = await call('POST', '/review/goals/g1/retire');
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ error: 'retire failed' });
  });
});

describe('POST /review/goals/:id/restore', () => {
  it('restores the goal to its prior status and returns it', async () => {
    const restored = { goal_id: 'g1', title: 'Obstacle race', status: 'committed', prior_status: null };
    restoreGoal.mockResolvedValue(restored);
    const r = await call('POST', '/review/goals/g1/restore');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true, goal: restored });
    expect(restoreGoal).toHaveBeenCalledWith('u1', 'g1');
  });

  it("404s when there is nothing to restore (not parked, or not this user's goal)", async () => {
    restoreGoal.mockResolvedValue(null);
    const r = await call('POST', '/review/goals/g1/restore');
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: 'goal not found or not retired' });
  });

  it('500s and reports failure when the repo throws', async () => {
    restoreGoal.mockRejectedValue(new Error('db down'));
    const r = await call('POST', '/review/goals/g1/restore');
    expect(r.status).toBe(500);
    expect(r.body).toEqual({ error: 'restore failed' });
  });
});
