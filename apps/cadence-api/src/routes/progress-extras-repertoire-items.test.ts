/**
 * GET /progress/repertoire/items — the list screen's own read (P6 "the room"). Own file, matching
 * progress-extras-repertoire.test.ts's own precedent: this route file carries many GET endpoints
 * owned by other parcels, and a shared test file is exactly the kind of single-file collision a
 * parallel wave should avoid.
 *
 * `listRepertoire` is mocked — this pins the ROUTE's own scoping and its use of `collidingTitles`,
 * not the SQL (no live-DB test anywhere in this codebase touches repo internals directly).
 * `collidingTitles` itself is NOT mocked: it is the real function from repertoire-match.ts, so this
 * test also proves the route asks it the right question rather than re-implementing the rule.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import type { RepertoireItem } from '@cadence/shared';

const listRepertoire = vi.fn();

vi.mock('../auth/middleware.ts', () => ({
  requireCadenceUser: (req: { cadenceUserId?: string }, _res: unknown, next: () => void) => {
    req.cadenceUserId = 'u1';
    next();
  },
}));

vi.mock('../repos/repertoire.ts', () => ({
  listRepertoire: (...a: unknown[]) => listRepertoire(...a),
}));

const { default: progressExtrasRoutes } = await import('./progress-extras.ts');

interface RouteResponse {
  status: number;
  body: Record<string, unknown>;
}

async function call(path: string): Promise<RouteResponse> {
  const app = express();
  app.use(express.json());
  app.use('/progress', progressExtrasRoutes);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`);
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

describe('GET /progress/repertoire/items — scoping', () => {
  it('with no goal_id, returns everything the user keeps, unattached material included', async () => {
    const rows = [item({ item_id: 'a', goal_id: 'g-piano' }), item({ item_id: 'b', goal_id: null, label: 'Waltz' })];
    listRepertoire.mockResolvedValue(rows);
    const r = await call('/progress/repertoire/items');
    expect(r.status).toBe(200);
    expect((r.body.items as RepertoireItem[]).map((i) => i.item_id)).toEqual(['a', 'b']);
    expect(listRepertoire).toHaveBeenCalledWith('u1');
  });

  it('with goal_id, returns only that goal — unattached rows do not leak in', async () => {
    const rows = [
      item({ item_id: 'a', goal_id: 'g-piano' }),
      item({ item_id: 'b', goal_id: null, label: 'Waltz' }),
      item({ item_id: 'c', goal_id: 'g-kata', label: 'Heian Shodan' }),
    ];
    listRepertoire.mockResolvedValue(rows);
    const r = await call('/progress/repertoire/items?goal_id=g-piano');
    expect(r.status).toBe(200);
    expect((r.body.items as RepertoireItem[]).map((i) => i.item_id)).toEqual(['a']);
  });

  it('a goal with nothing on it comes back with an empty list, never an error', async () => {
    listRepertoire.mockResolvedValue([item({ goal_id: 'g-other' })]);
    const r = await call('/progress/repertoire/items?goal_id=g-empty');
    expect(r.status).toBe(200);
    expect(r.body.items).toEqual([]);
    expect(r.body.collisions).toEqual([]);
  });

  it('rejects an empty-string goal_id rather than silently treating it as "everything"', async () => {
    const r = await call('/progress/repertoire/items?goal_id=');
    expect(r.status).toBe(400);
    expect(listRepertoire).not.toHaveBeenCalled();
  });
});

describe('GET /progress/repertoire/items — collisions', () => {
  it('two pieces sharing a title come back as one collision group naming both labels', async () => {
    listRepertoire.mockResolvedValue([
      item({ item_id: 'a', label: 'Minuet in G Major, BWV 822' }),
      item({ item_id: 'b', label: 'Minuet in G Major (Anna Magdalena Notebook)' }),
    ]);
    const r = await call('/progress/repertoire/items');
    expect(r.status).toBe(200);
    const collisions = r.body.collisions as Array<{ shared: string; labels: string[] }>;
    expect(collisions.length).toBeGreaterThan(0);
    const group = collisions.find((g) => g.labels.includes('Minuet in G Major, BWV 822'));
    expect(group?.labels).toContain('Minuet in G Major (Anna Magdalena Notebook)');
  });

  it('a shelf with no shared titles reports no collisions — the common case costs nothing extra', async () => {
    listRepertoire.mockResolvedValue([
      item({ item_id: 'a', label: 'Clair de lune' }),
      item({ item_id: 'b', label: 'Waltz' }),
    ]);
    const r = await call('/progress/repertoire/items');
    expect(r.status).toBe(200);
    expect(r.body.collisions).toEqual([]);
  });

  it('collisions run on the SCOPED set only — a same-titled row outside the goal cannot trigger one inside it', async () => {
    // 'Étude' and 'Etude' fold to the same needle (normTitle), so together they WOULD collide —
    // but 'b' sits on a different goal and this call scopes to g-piano, so only 'a' ever reaches
    // collidingTitles. Scoping must happen before collision detection, never after: computing
    // collisions over the whole shelf and filtering the ROWS afterward would report a collision
    // this goal's own screen has no way to explain, since the other half is never shown on it.
    listRepertoire.mockResolvedValue([
      item({ item_id: 'a', goal_id: 'g-piano', label: 'Étude' }),
      item({ item_id: 'b', goal_id: null, label: 'Etude' }),
    ]);
    const r = await call('/progress/repertoire/items?goal_id=g-piano');
    expect(r.body.collisions).toEqual([]);
  });
});

describe('GET /progress/repertoire/items — failure', () => {
  it('a repo failure is a 500, never an empty list read as "nothing on file"', async () => {
    listRepertoire.mockRejectedValue(new Error('db down'));
    const r = await call('/progress/repertoire/items');
    expect(r.status).toBe(500);
  });
});
