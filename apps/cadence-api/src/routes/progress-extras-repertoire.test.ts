/**
 * PATCH/DELETE /progress/repertoire/:id — the item screen's two write routes (P2: the item,
 * opened). Own file rather than a shared progress-extras.test.ts: this route file carries many
 * GET endpoints owned by other parcels in the same wave, and a shared test file is exactly the
 * kind of single-file collision a parallel wave should avoid.
 *
 * Same express-on-an-ephemeral-port harness as plan-replan.test.ts. The repo layer and
 * `invalidateSessionsFor` are mocked — this file pins the ROUTE's own orchestration (status
 * codes, which repo calls fire, error → response mapping), not the SQL, which has no live-DB
 * test anywhere in this codebase (repos/goals.test.ts, the closest precedent, tests a pure
 * exported constant only).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import type { RepertoireItem } from '@cadence/shared';

const renameRepertoireItem = vi.fn();
const updateRepertoireItem = vi.fn();
const deleteRepertoireItem = vi.fn();
const invalidateSessionsFor = vi.fn(async (..._a: unknown[]) => {});

vi.mock('../auth/middleware.ts', () => ({
  requireCadenceUser: (req: { cadenceUserId?: string }, _res: unknown, next: () => void) => {
    req.cadenceUserId = 'u1';
    next();
  },
}));

// repos/repertoire.ts's RepertoireRenameConflictError is a real class the route checks with
// `instanceof` — vi.mock must still export the real class, not a stub, or that check silently
// falls through to the 500 branch and the 409 test would pass for the wrong reason.
const actualRepo = await vi.importActual<typeof import('../repos/repertoire.ts')>('../repos/repertoire.ts');
vi.mock('../repos/repertoire.ts', () => ({
  RepertoireRenameConflictError: actualRepo.RepertoireRenameConflictError,
  renameRepertoireItem: (...a: unknown[]) => renameRepertoireItem(...a),
  updateRepertoireItem: (...a: unknown[]) => updateRepertoireItem(...a),
  deleteRepertoireItem: (...a: unknown[]) => deleteRepertoireItem(...a),
}));
vi.mock('../services/repertoire-practice.ts', () => ({
  invalidateSessionsFor: (...a: unknown[]) => invalidateSessionsFor(...a),
}));

const { default: progressExtrasRoutes } = await import('./progress-extras.ts');
const { RepertoireRenameConflictError } = actualRepo;

interface RouteResponse {
  status: number;
  body: Record<string, unknown>;
}

async function call(method: 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<RouteResponse> {
  const app = express();
  app.use(express.json());
  app.use('/progress', progressExtrasRoutes);
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

function item(over: Partial<RepertoireItem> = {}): RepertoireItem {
  return {
    item_id: 'it-1',
    user_id: 'u1',
    goal_id: null,
    label: 'Clair de lune',
    status: 'known',
    kind: 'piece',
    meta: null,
    started_at: '2026-01-01T00:00:00Z',
    learned_at: null,
    last_practiced_at: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('PATCH /progress/repertoire/:id — validation (near-misses before the repo is ever called)', () => {
  it('rejects an empty body — nothing to update', async () => {
    const r = await call('PATCH', '/progress/repertoire/it-1', {});
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/nothing to update/i);
    expect(renameRepertoireItem).not.toHaveBeenCalled();
  });

  it('rejects "learned" by name — that is the coach\'s verb, not a standing set here', async () => {
    const r = await call('PATCH', '/progress/repertoire/it-1', { status: 'learned' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/coach's word/i);
    expect(updateRepertoireItem).not.toHaveBeenCalled();
  });

  it('rejects "parked" by name — it was retired with the old three-state scheme', async () => {
    const r = await call('PATCH', '/progress/repertoire/it-1', { status: 'parked' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/parked.*gone/i);
  });

  it('rejects an unrelated garbage status word with the plain enum message', async () => {
    const r = await call('PATCH', '/progress/repertoire/it-1', { status: 'archived' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('status must be one of: queued, working, known, retired');
  });

  it.each(['queued', 'working', 'known', 'retired'])('accepts the real standing %s', async (status) => {
    updateRepertoireItem.mockResolvedValue(item({ status: status as RepertoireItem['status'] }));
    const r = await call('PATCH', '/progress/repertoire/it-1', { status });
    expect(r.status).toBe(200);
    expect(updateRepertoireItem).toHaveBeenCalledWith('u1', 'it-1', { status, meta: undefined });
  });

  it('rejects a blank label rather than silently ignoring it', async () => {
    const r = await call('PATCH', '/progress/repertoire/it-1', { label: '   ' });
    expect(r.status).toBe(400);
    expect(renameRepertoireItem).not.toHaveBeenCalled();
  });
});

describe('PATCH /progress/repertoire/:id — rename', () => {
  it('renames and returns the fresh row, preserving the id', async () => {
    renameRepertoireItem.mockResolvedValue(item({ label: 'Clair de lune (easier arrangement)' }));
    const r = await call('PATCH', '/progress/repertoire/it-1', { label: 'Clair de lune (easier arrangement)' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ item_id: 'it-1', label: 'Clair de lune (easier arrangement)' });
    expect(renameRepertoireItem).toHaveBeenCalledWith('u1', 'it-1', 'Clair de lune (easier arrangement)');
  });

  it('a collision is refused with 409 naming the other piece, never merged', async () => {
    renameRepertoireItem.mockRejectedValue(new RepertoireRenameConflictError('Clair de lune'));
    const r = await call('PATCH', '/progress/repertoire/it-1', { label: 'Clair de lune' });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('"Clair de lune" already has this name');
    expect(updateRepertoireItem).not.toHaveBeenCalled();
  });

  it("404s when the item is not this user's (or does not exist) rather than throwing", async () => {
    renameRepertoireItem.mockResolvedValue(null);
    const r = await call('PATCH', '/progress/repertoire/nope', { label: 'Anything' });
    expect(r.status).toBe(404);
  });

  it('sends composer/collection/catalogue as one merged meta patch alongside a status change', async () => {
    updateRepertoireItem.mockResolvedValue(item());
    const r = await call('PATCH', '/progress/repertoire/it-1', {
      composer: 'Debussy',
      collection: 'Suite bergamasque',
      status: 'retired',
    });
    expect(r.status).toBe(200);
    expect(updateRepertoireItem).toHaveBeenCalledWith('u1', 'it-1', {
      status: 'retired',
      meta: { composer: 'Debussy', collection: 'Suite bergamasque' },
    });
  });

  it("invalidates the goal's cached sessions when the changed item is linked to a goal", async () => {
    const row = item({ goal_id: 'g-piano', status: 'retired' });
    updateRepertoireItem.mockResolvedValue(row);
    await call('PATCH', '/progress/repertoire/it-1', { status: 'retired' });
    expect(invalidateSessionsFor).toHaveBeenCalledWith('u1', [row]);
  });

  it('does not invalidate anything for an item with no goal', async () => {
    updateRepertoireItem.mockResolvedValue(item({ goal_id: null, status: 'retired' }));
    await call('PATCH', '/progress/repertoire/it-1', { status: 'retired' });
    expect(invalidateSessionsFor).not.toHaveBeenCalled();
  });
});

describe('DELETE /progress/repertoire/:id', () => {
  it('deletes and reports ok', async () => {
    deleteRepertoireItem.mockResolvedValue({ item_id: 'it-1', goal_id: null });
    const r = await call('DELETE', '/progress/repertoire/it-1');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
    expect(deleteRepertoireItem).toHaveBeenCalledWith('u1', 'it-1');
  });

  it("404s for an item that is not there (already gone, or never this user's)", async () => {
    deleteRepertoireItem.mockResolvedValue(null);
    const r = await call('DELETE', '/progress/repertoire/nope');
    expect(r.status).toBe(404);
  });

  it("invalidates the goal's cached sessions when the deleted item was linked to one", async () => {
    deleteRepertoireItem.mockResolvedValue({ item_id: 'it-1', goal_id: 'g-piano' });
    await call('DELETE', '/progress/repertoire/it-1');
    expect(invalidateSessionsFor).toHaveBeenCalledWith('u1', [{ item_id: 'it-1', goal_id: 'g-piano' }]);
  });
});
