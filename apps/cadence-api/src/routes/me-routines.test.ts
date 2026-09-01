/**
 * /me/routines — thin route coverage: body validation actually rejects garbage before the
 * service ever sees it, and each service failure status (404/409/400) reaches the client
 * unchanged. The store's real logic (mint/re-mint, run, schedule, ranking) is pinned in
 * services/user-routines.test.ts. Everything is mocked, so this never reaches db/sql.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';

const listUserRoutines = vi.fn();
const createUserRoutine = vi.fn();
const updateUserRoutine = vi.fn();
const deleteUserRoutine = vi.fn();
const runUserRoutine = vi.fn();
const scheduleUserRoutine = vi.fn();
const unscheduleUserRoutine = vi.fn();

vi.mock('../services/user-routines.ts', () => ({
  listUserRoutines: (...a: unknown[]) => listUserRoutines(...a),
  createUserRoutine: (...a: unknown[]) => createUserRoutine(...a),
  updateUserRoutine: (...a: unknown[]) => updateUserRoutine(...a),
  deleteUserRoutine: (...a: unknown[]) => deleteUserRoutine(...a),
  runUserRoutine: (...a: unknown[]) => runUserRoutine(...a),
  scheduleUserRoutine: (...a: unknown[]) => scheduleUserRoutine(...a),
  unscheduleUserRoutine: (...a: unknown[]) => unscheduleUserRoutine(...a),
}));
vi.mock('../auth/middleware.ts', () => ({
  requireCadenceUser: (req: { cadenceUserId?: string }, _res: unknown, next: () => void) => {
    req.cadenceUserId = 'u1';
    next();
  },
}));

const { default: meRoutinesRoutes } = await import('./me-routines.ts');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/me', meRoutinesRoutes);
  return a;
}

/** Minimal fetch against the route, without pulling in supertest. */
async function call(path: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const server = app().listen(0);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, init);
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  } finally {
    server.close();
  }
}

const jsonBody = (payload: unknown, method = 'POST'): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(payload),
});

const VALID_CREATE = {
  name: 'Piano practice',
  session: { blocks: [{ label: 'Main', items: [{ name: 'Scales' }] }] },
  provenance: { kind: 'blank' },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('GET /me/routines', () => {
  it('returns everything the service gives back, wrapped', async () => {
    listUserRoutines.mockResolvedValue([{ routine_id: 'r1' }]);
    const { status, body } = await call('/me/routines');
    expect(status).toBe(200);
    expect(body).toEqual({ routines: [{ routine_id: 'r1' }] });
    expect(listUserRoutines).toHaveBeenCalledWith('u1');
  });

  it('answers 500 rather than a half-built list when the read fails', async () => {
    listUserRoutines.mockRejectedValue(new Error('db down'));
    const { status } = await call('/me/routines');
    expect(status).toBe(500);
  });
});

describe('POST /me/routines', () => {
  it('creates and returns the routine on a valid body', async () => {
    createUserRoutine.mockResolvedValue({ routine_id: 'r1', name: 'Piano practice' });
    const { status, body } = await call('/me/routines', jsonBody(VALID_CREATE));
    expect(status).toBe(200);
    expect(body).toEqual({ routine_id: 'r1', name: 'Piano practice' });
    expect(createUserRoutine).toHaveBeenCalledWith('u1', VALID_CREATE);
  });

  it('400s on a missing name — never reaches the service', async () => {
    const { status } = await call('/me/routines', jsonBody({ ...VALID_CREATE, name: '' }));
    expect(status).toBe(400);
    expect(createUserRoutine).not.toHaveBeenCalled();
  });

  it('400s on a session with no blocks — never reaches the service', async () => {
    const { status } = await call('/me/routines', jsonBody({ ...VALID_CREATE, session: { blocks: [] } }));
    expect(status).toBe(400);
    expect(createUserRoutine).not.toHaveBeenCalled();
  });

  it('400s on a missing provenance.kind', async () => {
    const { status } = await call('/me/routines', jsonBody({ ...VALID_CREATE, provenance: { kind: 'nonsense' } }));
    expect(status).toBe(400);
  });

  it('400s when the service says the session had nothing usable in it', async () => {
    createUserRoutine.mockResolvedValue(null);
    const { status } = await call('/me/routines', jsonBody(VALID_CREATE));
    expect(status).toBe(400);
  });
});

describe('PATCH /me/routines/:id', () => {
  it('applies the patch and returns the updated routine', async () => {
    updateUserRoutine.mockResolvedValue({ ok: true, routine: { routine_id: 'r1', name: 'New name' } });
    const { status, body } = await call('/me/routines/r1', jsonBody({ name: 'New name' }, 'PATCH'));
    expect(status).toBe(200);
    expect(body).toEqual({ routine_id: 'r1', name: 'New name' });
    expect(updateUserRoutine).toHaveBeenCalledWith('u1', 'r1', { name: 'New name' });
  });

  it('400s an empty body — nothing to update', async () => {
    const { status } = await call('/me/routines/r1', jsonBody({}, 'PATCH'));
    expect(status).toBe(400);
    expect(updateUserRoutine).not.toHaveBeenCalled();
  });

  it("passes through the service's status for a routine that isn't this user's", async () => {
    updateUserRoutine.mockResolvedValue({ ok: false, status: 404 });
    const { status } = await call('/me/routines/not-mine', jsonBody({ name: 'X' }, 'PATCH'));
    expect(status).toBe(404);
  });
});

describe('DELETE /me/routines/:id', () => {
  it('deletes and answers ok:true', async () => {
    deleteUserRoutine.mockResolvedValue(true);
    const { status, body } = await call('/me/routines/r1', { method: 'DELETE' });
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true });
  });

  it("404s for a routine that isn't this user's — no leak", async () => {
    deleteUserRoutine.mockResolvedValue(false);
    const { status } = await call('/me/routines/not-mine', { method: 'DELETE' });
    expect(status).toBe(404);
  });
});

describe('POST /me/routines/:id/run', () => {
  it('credits a run', async () => {
    runUserRoutine.mockResolvedValue({ ok: true });
    const { status, body } = await call('/me/routines/r1/run', { method: 'POST' });
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(runUserRoutine).toHaveBeenCalledWith('u1', 'r1');
  });

  it('409s when the service reports no active plan', async () => {
    runUserRoutine.mockResolvedValue({ ok: false, status: 409 });
    const { status } = await call('/me/routines/r1/run', { method: 'POST' });
    expect(status).toBe(409);
  });

  it("404s for a routine that isn't this user's", async () => {
    runUserRoutine.mockResolvedValue({ ok: false, status: 404 });
    const { status } = await call('/me/routines/not-mine/run', { method: 'POST' });
    expect(status).toBe(404);
  });
});

describe('POST /me/routines/:id/schedule', () => {
  it('schedules on a valid body', async () => {
    scheduleUserRoutine.mockResolvedValue({ ok: true });
    const { status } = await call(
      '/me/routines/r1/schedule',
      jsonBody({ days: ['mon', 'wed'], time_of_day: 'morning' }),
    );
    expect(status).toBe(200);
    expect(scheduleUserRoutine).toHaveBeenCalledWith('u1', 'r1', { days: ['mon', 'wed'], time_of_day: 'morning' });
  });

  it('400s on an empty days array — never reaches the service', async () => {
    const { status } = await call('/me/routines/r1/schedule', jsonBody({ days: [] }));
    expect(status).toBe(400);
    expect(scheduleUserRoutine).not.toHaveBeenCalled();
  });

  it('400s on a bad day name', async () => {
    const { status } = await call('/me/routines/r1/schedule', jsonBody({ days: ['someday'] }));
    expect(status).toBe(400);
  });

  it('409s (ok:false) when there is no active plan to schedule onto', async () => {
    scheduleUserRoutine.mockResolvedValue({ ok: false, status: 409 });
    const { status } = await call('/me/routines/r1/schedule', jsonBody({ days: ['mon'] }));
    expect(status).toBe(409);
  });
});

describe('DELETE /me/routines/:id/schedule', () => {
  it('unschedules', async () => {
    unscheduleUserRoutine.mockResolvedValue({ ok: true });
    const { status, body } = await call('/me/routines/r1/schedule', { method: 'DELETE' });
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true });
    expect(unscheduleUserRoutine).toHaveBeenCalledWith('u1', 'r1');
  });

  it("404s for a routine that isn't this user's", async () => {
    unscheduleUserRoutine.mockResolvedValue({ ok: false, status: 404 });
    const { status } = await call('/me/routines/not-mine/schedule', { method: 'DELETE' });
    expect(status).toBe(404);
  });
});
