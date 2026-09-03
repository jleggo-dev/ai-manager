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
const listRepertoire = vi.fn(async (..._a: unknown[]): Promise<unknown[]> => []);
const invalidateSessionsFor = vi.fn(async (..._a: unknown[]) => {});
const collidingTitles = vi.fn(() => []);
const listCollections = vi.fn(async (..._a: unknown[]): Promise<unknown[]> => []);

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
  listRepertoire: (...a: unknown[]) => listRepertoire(...a),
}));
vi.mock('../repos/repertoire-collections.ts', () => ({
  listCollections: (...a: unknown[]) => listCollections(...a),
}));
vi.mock('../services/repertoire-practice.ts', () => ({
  invalidateSessionsFor: (...a: unknown[]) => invalidateSessionsFor(...a),
  collidingTitles: (...a: unknown[]) => collidingTitles(...(a as [])),
}));

const { default: progressExtrasRoutes } = await import('./progress-extras.ts');
const { RepertoireRenameConflictError } = actualRepo;

interface RouteResponse {
  status: number;
  body: Record<string, unknown>;
}

async function call(method: 'GET' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<RouteResponse> {
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
    collection_id: null,
    collection_name: null,
    started_at: '2026-01-01T00:00:00Z',
    learned_at: null,
    last_practiced_at: null,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  listCollections.mockResolvedValue([]);
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

  // `rank` — the Up next group's drag order (P6 "the room"). Table: a real 1-based rank passes,
  // and the near-misses a drag interaction could actually produce (dropped at the top: 0; a
  // fractional position from a naive average-of-neighbours reorder: 1.5; a stringly-typed body: "2").
  it.each([
    [0, 'zero is not a 1-based position'],
    [1.5, 'not a whole number'],
    ['2', 'not a number at all'],
  ])('rejects rank %j (%s)', async (rank: number | string, _why: string) => {
    const r = await call('PATCH', '/progress/repertoire/it-1', { rank });
    expect(r.status).toBe(400);
    expect(updateRepertoireItem).not.toHaveBeenCalled();
  });
});

/**
 * The collection, by id (P11, migration 0056). It stopped being a NAME on the item: the item
 * carries `collection_id` and reads `collection_name` back, so renaming a collection renames it
 * everywhere at once and two spellings cannot become two groups.
 *
 * Three cases, and all three fail silently if the route gets them wrong — the wrong value saves,
 * the screen looks right, and the person finds the item in the wrong place (or in none) later:
 * omitted leaves the item where it is, a uuid files it, and an explicit null takes it out.
 */
describe('PATCH /progress/repertoire/:id — the collection', () => {
  beforeEach(() => {
    updateRepertoireItem.mockResolvedValue(item());
  });

  it('files the item into the collection whose id was sent', async () => {
    const r = await call('PATCH', '/progress/repertoire/it-1', {
      collection_id: '11111111-1111-4111-8111-111111111111',
    });
    expect(r.status).toBe(200);
    expect(updateRepertoireItem).toHaveBeenCalledWith('u1', 'it-1', {
      status: undefined,
      meta: undefined,
      collection_id: '11111111-1111-4111-8111-111111111111',
    });
  });

  /** "None" on the item screen. `null` has to reach the repo as null, not as "leave it alone" —
   *  otherwise nothing can ever be taken out of a collection again. */
  it('an explicit null takes it out of every collection', async () => {
    const r = await call('PATCH', '/progress/repertoire/it-1', { collection_id: null });
    expect(r.status).toBe(200);
    expect(updateRepertoireItem).toHaveBeenCalledWith('u1', 'it-1', {
      status: undefined,
      meta: undefined,
      collection_id: null,
    });
  });

  it('omitting it leaves the row where it is — the field is not sent at all', async () => {
    await call('PATCH', '/progress/repertoire/it-1', { note: 'bars 9-16' });
    expect(updateRepertoireItem).toHaveBeenCalledWith('u1', 'it-1', {
      status: undefined,
      meta: { practice_note: 'bars 9-16' },
    });
  });

  it('rides alongside a standing change and the qualifiers in one write', async () => {
    await call('PATCH', '/progress/repertoire/it-1', {
      status: 'known',
      composer: 'Hummel',
      collection_id: '22222222-2222-4222-8222-222222222222',
    });
    expect(updateRepertoireItem).toHaveBeenCalledWith('u1', 'it-1', {
      status: 'known',
      meta: { composer: 'Hummel' },
      collection_id: '22222222-2222-4222-8222-222222222222',
    });
  });

  /** The near-misses a client can actually produce: a name where an id belongs, a blank, and the
   *  old field. Each must be refused rather than half-written — a name silently ignored would look
   *  like the collection saved and quietly leave the item ungrouped. */
  it.each([
    ['Suzuki Book 2', 'a name where an id belongs'],
    ['', 'a blank'],
    ['not-a-uuid', 'a wrong-shaped id'],
  ])('rejects collection_id %j (%s)', async (collection_id: string, _why: string) => {
    const r = await call('PATCH', '/progress/repertoire/it-1', { collection_id });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/collection_id must be a uuid/);
    expect(updateRepertoireItem).not.toHaveBeenCalled();
  });

  it('treats a collection-by-name body as nothing to update — the field is gone', async () => {
    const r = await call('PATCH', '/progress/repertoire/it-1', { collection: 'Suzuki Book 2' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/nothing to update/i);
    expect(updateRepertoireItem).not.toHaveBeenCalled();
  });

  it('never reads the shelf to work a collection out any more', async () => {
    await call('PATCH', '/progress/repertoire/it-1', {
      collection_id: '11111111-1111-4111-8111-111111111111',
    });
    expect(listRepertoire).not.toHaveBeenCalled();
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

  it('sends composer/description/note as one merged meta patch alongside a status change', async () => {
    updateRepertoireItem.mockResolvedValue(item());
    const r = await call('PATCH', '/progress/repertoire/it-1', {
      composer: 'Debussy',
      description: 'the moonlight one',
      note: 'the middle section',
      status: 'retired',
    });
    expect(r.status).toBe(200);
    expect(updateRepertoireItem).toHaveBeenCalledWith('u1', 'it-1', {
      status: 'retired',
      meta: { composer: 'Debussy', description: 'the moonlight one', practice_note: 'the middle section' },
    });
  });

  /**
   * The description (owner ruling 2026-09-03) — their own words for which one it is, and the field
   * that replaced `catalogue`. It gets 240 characters rather than the qualifiers' 120 because it is
   * a sentence; the near-misses are the two a text field actually produces.
   */
  it('accepts a description-only body', async () => {
    updateRepertoireItem.mockResolvedValue(item());
    const r = await call('PATCH', '/progress/repertoire/it-1', { description: 'the fast one in G' });
    expect(r.status).toBe(200);
    expect(updateRepertoireItem).toHaveBeenCalledWith('u1', 'it-1', {
      status: undefined,
      meta: { description: 'the fast one in G' },
    });
  });

  it('rejects a blank description rather than storing an empty one', async () => {
    const r = await call('PATCH', '/progress/repertoire/it-1', { description: '   ' });
    expect(r.status).toBe(400);
    expect(updateRepertoireItem).not.toHaveBeenCalled();
  });

  it('rejects a description past its own 240-character bound, and accepts one at it', async () => {
    const over = await call('PATCH', '/progress/repertoire/it-1', { description: 'x'.repeat(241) });
    expect(over.status).toBe(400);
    expect(over.body.error).toMatch(/240 characters/);

    updateRepertoireItem.mockResolvedValue(item());
    const at = await call('PATCH', '/progress/repertoire/it-1', { description: 'x'.repeat(240) });
    expect(at.status).toBe(200);
  });

  /** `catalogue` was a field here until 2026-09-03. A body carrying only it now has nothing to
   *  write, and must say so rather than silently succeeding with an empty patch. */
  it('treats a catalogue-only body as nothing to update — the field is gone', async () => {
    const r = await call('PATCH', '/progress/repertoire/it-1', { catalogue: 'BWV 822' });
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(/nothing to update/i);
    expect(updateRepertoireItem).not.toHaveBeenCalled();
  });

  it('accepts a rank-only body — reordering Up next needs no other field', async () => {
    updateRepertoireItem.mockResolvedValue(item({ status: 'queued' }));
    const r = await call('PATCH', '/progress/repertoire/it-1', { rank: 3 });
    expect(r.status).toBe(200);
    expect(updateRepertoireItem).toHaveBeenCalledWith('u1', 'it-1', { status: undefined, meta: { rank: 3 } });
  });

  it('sends rank alongside a status change as one merged meta patch, like the other qualifiers', async () => {
    updateRepertoireItem.mockResolvedValue(item({ status: 'queued' }));
    const r = await call('PATCH', '/progress/repertoire/it-1', { status: 'queued', rank: 1, composer: 'Debussy' });
    expect(r.status).toBe(200);
    expect(updateRepertoireItem).toHaveBeenCalledWith('u1', 'it-1', {
      status: 'queued',
      meta: { composer: 'Debussy', rank: 1 },
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
