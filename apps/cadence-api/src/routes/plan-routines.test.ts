/**
 * GET /plan/routines — thin route coverage: the ?area param actually reaches the service, and a
 * service failure answers 500 rather than a half-built list. The grouping/ranking logic itself is
 * pinned in services/routines.test.ts. Everything is mocked, so this never reaches db/sql.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';

const listRoutines = vi.fn();
const getRoutineSession = vi.fn();

vi.mock('../services/routines.ts', () => ({
  listRoutines: (...a: unknown[]) => listRoutines(...a),
  getRoutineSession: (...a: unknown[]) => getRoutineSession(...a),
  parseAreaParam: (v: unknown) =>
    v === 'movement' || v === 'nourishment' || v === 'mind' || v === 'practice' ? v : undefined,
}));
vi.mock('../auth/middleware.ts', () => ({
  requireCadenceUser: (req: { cadenceUserId?: string }, _res: unknown, next: () => void) => {
    req.cadenceUserId = 'u1';
    next();
  },
}));

const { default: planRoutinesRoutes } = await import('./plan-routines.ts');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/plan', planRoutinesRoutes);
  return a;
}

/** Minimal fetch against the route, without pulling in supertest. */
async function call(path: string): Promise<{ status: number; body: unknown }> {
  const server = app().listen(0);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  } finally {
    server.close();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  listRoutines.mockResolvedValue([]);
  getRoutineSession.mockResolvedValue(null);
});

describe('GET /plan/routines', () => {
  it('returns the routines list wrapped in an object', async () => {
    listRoutines.mockResolvedValue([
      { commitment_id: 'c1', title: 'Easy 5k', steps: [], finishes: 3, last_done: null, on_plan: true },
    ]);
    const { status, body } = await call('/plan/routines');
    expect(status).toBe(200);
    expect(body).toEqual({
      routines: [{ commitment_id: 'c1', title: 'Easy 5k', steps: [], finishes: 3, last_done: null, on_plan: true }],
    });
    expect(listRoutines).toHaveBeenCalledWith('u1', undefined);
  });

  it('passes a valid ?area straight through to the service', async () => {
    await call('/plan/routines?area=practice');
    expect(listRoutines).toHaveBeenCalledWith('u1', 'practice');
  });

  it('treats an unrecognized ?area as no filter rather than erroring', async () => {
    const { status } = await call('/plan/routines?area=cardio');
    expect(status).toBe(200);
    expect(listRoutines).toHaveBeenCalledWith('u1', undefined);
  });

  it('answers 500 rather than a half-built list when the read fails', async () => {
    listRoutines.mockRejectedValue(new Error('db down'));
    const { status } = await call('/plan/routines');
    expect(status).toBe(500);
  });
});

describe('GET /plan/routines/:commitmentId/session', () => {
  const SESSION = {
    blocks: [{ label: 'Main', items: [{ name: 'Warm-up' }] }],
    note: '',
    generated_at: '2026-08-01T00:00:00Z',
    version: 1,
  };

  it('returns the newest cached session for the lineage', async () => {
    getRoutineSession.mockResolvedValue(SESSION);
    const { status, body } = await call('/plan/routines/c1/session');
    expect(status).toBe(200);
    expect(body).toEqual({ session: SESSION });
    expect(getRoutineSession).toHaveBeenCalledWith('u1', 'c1');
  });

  it('returns { session: null } for a lineage that has never had a session cached', async () => {
    getRoutineSession.mockResolvedValue(null);
    const { status, body } = await call('/plan/routines/c1/session');
    expect(status).toBe(200);
    expect(body).toEqual({ session: null });
  });

  it('returns { session: null } — not 404 — for a commitment id belonging to nobody or another user', async () => {
    // The service's user_id-scoped query already can't return a foreign row; the route makes no
    // separate ownership check, so this is the SAME response as "never cached" — nothing to leak.
    getRoutineSession.mockResolvedValue(null);
    const { status, body } = await call('/plan/routines/not-mine/session');
    expect(status).toBe(200);
    expect(body).toEqual({ session: null });
    expect(getRoutineSession).toHaveBeenCalledWith('u1', 'not-mine');
  });

  it('answers 500 rather than a half-built response when the read fails', async () => {
    getRoutineSession.mockRejectedValue(new Error('db down'));
    const { status } = await call('/plan/routines/c1/session');
    expect(status).toBe(500);
  });
});
