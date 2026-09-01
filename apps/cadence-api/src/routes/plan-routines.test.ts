/**
 * GET /plan/routines — thin route coverage: the ?area param actually reaches the service, and a
 * service failure answers 500 rather than a half-built list. The grouping/ranking logic itself is
 * pinned in services/routines.test.ts. Everything is mocked, so this never reaches db/sql.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';

const listRoutines = vi.fn();

vi.mock('../services/routines.ts', () => ({
  listRoutines: (...a: unknown[]) => listRoutines(...a),
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
