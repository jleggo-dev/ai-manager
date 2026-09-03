/**
 * The four collection routes (P11, migration 0056) — every button on the collections screen, and
 * the near-miss beside each one.
 *
 * Same express-on-an-ephemeral-port harness as progress-extras-repertoire.test.ts, and the same
 * boundary: the repo is mocked, so what is pinned here is the ROUTE's own orchestration — status
 * codes, which repo call fires, error → response mapping — not the SQL. There is no live-DB test
 * of repo internals anywhere in this codebase, and the database these suites share is the real one.
 *
 * `collectionKey` is exercised on its own here too. It is the TypeScript spelling of the unique
 * index (`lower(name)`), it decides behaviour, and it is silent when it is wrong: a fold that is
 * too loose files a piece into a collection nobody chose, and no fold at all leaves "Suzuki Book 2"
 * and "suzuki book 2" as two groups that will never merge.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';

const listCollections = vi.fn();
const createCollection = vi.fn();
const renameCollection = vi.fn();
const deleteCollection = vi.fn();

vi.mock('../auth/middleware.ts', () => ({
  requireCadenceUser: (req: { cadenceUserId?: string }, _res: unknown, next: () => void) => {
    req.cadenceUserId = 'u1';
    next();
  },
}));

// The conflict error is a real class the routes check with `instanceof` — a stub would make the
// 409 test pass through the 500 branch instead, for the wrong reason.
const actualRepo = await vi.importActual<typeof import('../repos/repertoire-collections.ts')>(
  '../repos/repertoire-collections.ts',
);
vi.mock('../repos/repertoire-collections.ts', () => ({
  RepertoireCollectionConflictError: actualRepo.RepertoireCollectionConflictError,
  collectionKey: actualRepo.collectionKey,
  listCollections: (...a: unknown[]) => listCollections(...a),
  createCollection: (...a: unknown[]) => createCollection(...a),
  renameCollection: (...a: unknown[]) => renameCollection(...a),
  deleteCollection: (...a: unknown[]) => deleteCollection(...a),
}));

const { default: routes } = await import('./repertoire-collections.ts');
const { RepertoireCollectionConflictError, collectionKey } = actualRepo;

interface RouteResponse {
  status: number;
  body: Record<string, unknown>;
}

async function call(method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string, body?: unknown): Promise<RouteResponse> {
  const app = express();
  app.use(express.json());
  app.use('/progress', routes);
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

const collection = (over: Partial<{ collection_id: string; name: string; item_count: number }> = {}) => ({
  collection_id: 'c-1',
  name: 'Suzuki Book 2',
  item_count: 3,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe('collectionKey — the fold, and only the fold', () => {
  it.each([
    ['Suzuki Book 2', 'suzuki book 2'],
    ['suzuki book 2', 'suzuki book 2'],
    ['  Suzuki Book 2  ', 'suzuki book 2'],
    ['SUZUKI BOOK 2', 'suzuki book 2'],
  ])('folds %j to %j', (typed, expected) => {
    expect(collectionKey(typed)).toBe(expected);
  });

  /** The near-miss half. Anything looser would file an item under a group nobody chose, which is
   *  worse than a second group they can see and merge. */
  it.each([['Suzuki 2'], ['Suzuki Book Two'], ['Suzuki  Book  2'], ['Suzuki Book 3'], ['Book 2']])(
    'keeps %j apart from "Suzuki Book 2" — it is a similar name, not the same one',
    (typed) => {
      expect(collectionKey(typed)).not.toBe(collectionKey('Suzuki Book 2'));
    },
  );
});

describe('GET /progress/repertoire/collections', () => {
  it('returns the rows under a "collections" key', async () => {
    listCollections.mockResolvedValue([
      collection(),
      collection({ collection_id: 'c-2', name: 'Someday', item_count: 0 }),
    ]);
    const r = await call('GET', '/progress/repertoire/collections');
    expect(r.status).toBe(200);
    expect(r.body.collections).toEqual([
      { collection_id: 'c-1', name: 'Suzuki Book 2', item_count: 3 },
      { collection_id: 'c-2', name: 'Someday', item_count: 0 },
    ]);
    expect(listCollections).toHaveBeenCalledWith('u1');
  });

  it('is an empty list for someone with none — never absent', async () => {
    listCollections.mockResolvedValue([]);
    const r = await call('GET', '/progress/repertoire/collections');
    expect(r.body.collections).toEqual([]);
  });

  it('a repo failure is a 500, never an empty list read as "you have none"', async () => {
    listCollections.mockRejectedValue(new Error('db down'));
    const r = await call('GET', '/progress/repertoire/collections');
    expect(r.status).toBe(500);
  });
});

describe('POST /progress/repertoire/collections — "Add a collection…"', () => {
  it('makes one and returns it with a count of zero', async () => {
    createCollection.mockResolvedValue(collection({ collection_id: 'c-9', name: 'ABRSM Grade 3', item_count: 0 }));
    const r = await call('POST', '/progress/repertoire/collections', { name: 'ABRSM Grade 3' });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ collection_id: 'c-9', name: 'ABRSM Grade 3', item_count: 0 });
    expect(createCollection).toHaveBeenCalledWith('u1', 'ABRSM Grade 3');
  });

  /** A name they already have, differently spelled, is REFUSED with the spelling on file — never
   *  folded silently onto it. They asked to make one; a silent fold looks like nothing happened. */
  it('a duplicate is 409, naming the spelling already on file', async () => {
    createCollection.mockRejectedValue(new RepertoireCollectionConflictError('Suzuki Book 2'));
    const r = await call('POST', '/progress/repertoire/collections', { name: 'suzuki book 2' });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('You already have a collection called "Suzuki Book 2".');
  });

  it.each([
    [{}, 'no name at all'],
    [{ name: '   ' }, 'a blank name'],
    [{ name: 'x'.repeat(121) }, 'a name past the 120-character bound'],
  ])('rejects %j (%s) before the repo is ever called', async (body: unknown, _why: string) => {
    const r = await call('POST', '/progress/repertoire/collections', body);
    expect(r.status).toBe(400);
    expect(createCollection).not.toHaveBeenCalled();
  });

  it('accepts a name exactly at the bound', async () => {
    createCollection.mockResolvedValue(collection({ name: 'x'.repeat(120) }));
    const r = await call('POST', '/progress/repertoire/collections', { name: 'x'.repeat(120) });
    expect(r.status).toBe(200);
  });

  it('a repo failure is a 500, never a 200 with nothing made', async () => {
    createCollection.mockRejectedValue(new Error('db down'));
    const r = await call('POST', '/progress/repertoire/collections', { name: 'ABRSM Grade 3' });
    expect(r.status).toBe(500);
  });
});

describe('PATCH /progress/repertoire/collections/:id — Rename', () => {
  it('renames and returns the fresh row, preserving the id', async () => {
    renameCollection.mockResolvedValue(collection({ name: 'Suzuki Piano Book 2' }));
    const r = await call('PATCH', '/progress/repertoire/collections/c-1', { name: 'Suzuki Piano Book 2' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ collection_id: 'c-1', name: 'Suzuki Piano Book 2' });
    expect(renameCollection).toHaveBeenCalledWith('u1', 'c-1', 'Suzuki Piano Book 2');
  });

  it('a name another collection already has is 409, naming that one', async () => {
    renameCollection.mockRejectedValue(new RepertoireCollectionConflictError('Shotokan kata syllabus'));
    const r = await call('PATCH', '/progress/repertoire/collections/c-1', { name: 'shotokan kata syllabus' });
    expect(r.status).toBe(409);
    expect(r.body.error).toBe('You already have a collection called "Shotokan kata syllabus".');
  });

  it("404s when the collection is not this user's (or does not exist)", async () => {
    renameCollection.mockResolvedValue(null);
    const r = await call('PATCH', '/progress/repertoire/collections/nope', { name: 'Anything' });
    expect(r.status).toBe(404);
  });

  it('rejects a blank name rather than storing one', async () => {
    const r = await call('PATCH', '/progress/repertoire/collections/c-1', { name: '  ' });
    expect(r.status).toBe(400);
    expect(renameCollection).not.toHaveBeenCalled();
  });
});

describe('DELETE /progress/repertoire/collections/:id — Remove', () => {
  it('removes it and reports ok', async () => {
    deleteCollection.mockResolvedValue(true);
    const r = await call('DELETE', '/progress/repertoire/collections/c-1');
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ ok: true });
    expect(deleteCollection).toHaveBeenCalledWith('u1', 'c-1');
  });

  /** A delete that deleted nothing must not report success — the screen would drop a row that is
   *  still there and come back with it on the next read. */
  it('404s for one that is not there (already gone, or never theirs)', async () => {
    deleteCollection.mockResolvedValue(false);
    const r = await call('DELETE', '/progress/repertoire/collections/nope');
    expect(r.status).toBe(404);
  });

  it('a repo failure is a 500', async () => {
    deleteCollection.mockRejectedValue(new Error('db down'));
    const r = await call('DELETE', '/progress/repertoire/collections/c-1');
    expect(r.status).toBe(500);
  });

  /** The whole point of `on delete set null`: this route touches no item. Nothing here calls into
   *  the items repo at all, and the screen's confirmation says so in the person's own words. */
  it('never touches an item — removing a collection is not removing what is in it', async () => {
    deleteCollection.mockResolvedValue(true);
    await call('DELETE', '/progress/repertoire/collections/c-1');
    expect(deleteCollection).toHaveBeenCalledTimes(1);
    expect(renameCollection).not.toHaveBeenCalled();
    expect(createCollection).not.toHaveBeenCalled();
  });
});
