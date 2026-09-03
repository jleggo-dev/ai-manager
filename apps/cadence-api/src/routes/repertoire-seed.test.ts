/**
 * The seed's two routes. Same express-on-an-ephemeral-port harness plan-changes.test.ts uses.
 *
 * The door is where the standing set has to hold: the screen is not a trusted client, and a body
 * asking for `retired` or `learned` must be refused at the boundary rather than trimmed quietly
 * further in. And a fault must not come back as 200 with an empty list — a client that cannot
 * tell "we broke" from "no such book" will say the wrong one out loud.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';

const expandCollection = vi.fn();
const confirmSeed = vi.fn();

vi.mock('../services/repertoire-seed.ts', () => ({
  expandCollection: (...a: unknown[]) => expandCollection(...a),
  confirmSeed: (...a: unknown[]) => confirmSeed(...a),
}));
vi.mock('../auth/middleware.ts', () => ({
  requireCadenceUser: (req: { cadenceUserId?: string }, _res: unknown, next: () => void) => {
    req.cadenceUserId = 'u1';
    next();
  },
}));

const { default: repertoireSeedRoutes } = await import('./repertoire-seed.ts');

interface RouteResponse {
  status: number;
  body: Record<string, unknown>;
}

async function call(path: string, body?: unknown): Promise<RouteResponse> {
  const app = express();
  app.use(express.json());
  app.use('/progress', repertoireSeedRoutes);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method: 'POST',
      ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown> };
  } finally {
    server.close();
  }
}

const candidate = (label: string, rank: number) => ({
  label,
  composer: null,
  collection: 'Suzuki Piano Book 2',
  rank,
  ambiguous: false,
});

beforeEach(() => {
  vi.clearAllMocks();
  expandCollection.mockResolvedValue({
    ok: true,
    collection: 'Suzuki Piano Book 2',
    candidates: [candidate('Écossaise', 1), candidate('Chanson', 2)],
  });
  confirmSeed.mockResolvedValue({ ok: true, written: 2, labels: ['Écossaise', 'Chanson'], refused: [] });
});

describe('POST /progress/repertoire/seed', () => {
  it('hands back the candidates with the collection it read them for', async () => {
    const r = await call('/progress/repertoire/seed', { collection: 'Suzuki Piano Book 2' });
    expect(r.status).toBe(200);
    expect(r.body.collection).toBe('Suzuki Piano Book 2');
    expect(r.body.candidates).toHaveLength(2);
    expect(expandCollection).toHaveBeenCalledWith('u1', 'Suzuki Piano Book 2', null);
  });

  /* The coach's door (P7): she may say WHERE in the book they are, and the answer to "which row is
     that" is worked out here rather than in the browser — a second matching rule in a client is
     the drift CLAUDE.md bans, and this one decides what gets pre-marked and therefore confirmed. */
  it('passes the piece she heard through, and hands back the rank it resolved to', async () => {
    expandCollection.mockResolvedValue({
      ok: true,
      collection: 'Suzuki Piano Book 2',
      candidates: [candidate('Écossaise', 1), candidate('Hungarian Folk Song', 2)],
      here_rank: 2,
    });
    const r = await call('/progress/repertoire/seed', {
      collection: 'Suzuki Piano Book 2',
      where_you_are: 'the hungarian folk song',
    });
    expect(r.status).toBe(200);
    expect(expandCollection).toHaveBeenCalledWith('u1', 'Suzuki Piano Book 2', 'the hungarian folk song');
    expect(r.body.here_rank).toBe(2);
  });

  it('treats a blank where-you-are as nothing heard, rather than as text to match on', async () => {
    const r = await call('/progress/repertoire/seed', { collection: 'Suzuki Piano Book 2', where_you_are: '   ' });
    expect(r.status).toBe(200);
    expect(expandCollection).toHaveBeenCalledWith('u1', 'Suzuki Piano Book 2', null);
  });

  it('always answers with here_rank, null when nothing was heard — never an absent field', async () => {
    const r = await call('/progress/repertoire/seed', { collection: 'Suzuki Piano Book 2' });
    expect(r.body).toHaveProperty('here_rank');
    expect(r.body.here_rank).toBeNull();
  });

  it('400s on an over-long where-you-are, and never calls the service', async () => {
    const r = await call('/progress/repertoire/seed', {
      collection: 'Suzuki Piano Book 2',
      where_you_are: 'x'.repeat(121),
    });
    expect(r.status).toBe(400);
    expect(expandCollection).not.toHaveBeenCalled();
  });

  it('an unknown collection is 200 with an empty list — an answer, not an error', async () => {
    expandCollection.mockResolvedValue({ ok: true, collection: 'Nope', candidates: [] });
    const r = await call('/progress/repertoire/seed', { collection: 'Nope' });
    expect(r.status).toBe(200);
    expect(r.body.candidates).toEqual([]);
  });

  it('a fault answers 502 with the fault text, never 200 with an empty list', async () => {
    expandCollection.mockResolvedValue({ ok: false, fault: 'a fault on our side' });
    const r = await call('/progress/repertoire/seed', { collection: 'Suzuki Piano Book 2' });
    expect(r.status).toBe(502);
    expect(String(r.body.error)).toMatch(/fault on our side/);
    expect(r.body.candidates).toBeUndefined();
  });

  it('400s on an empty collection name, and never calls the service', async () => {
    const r = await call('/progress/repertoire/seed', { collection: '   ' });
    expect(r.status).toBe(400);
    expect(expandCollection).not.toHaveBeenCalled();
  });

  it('400s on a missing body', async () => {
    const r = await call('/progress/repertoire/seed', {});
    expect(r.status).toBe(400);
  });
});

describe('POST /progress/repertoire/seed/confirm', () => {
  const rows = [
    { label: 'Écossaise', composer: 'J.N. Hummel', rank: 1, status: 'known' },
    { label: 'Chanson', rank: 2, status: 'working' },
  ];

  it('writes the rows under the named goal and reports what landed', async () => {
    const r = await call('/progress/repertoire/seed/confirm', {
      goal_id: '11111111-1111-4111-8111-111111111111',
      rows,
    });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ written: 2, labels: ['Écossaise', 'Chanson'], refused: [] });
    expect(confirmSeed).toHaveBeenCalledWith('u1', expect.any(Array), '11111111-1111-4111-8111-111111111111');
  });

  it('takes a null goal — "no goal, just keep it"', async () => {
    await call('/progress/repertoire/seed/confirm', { goal_id: null, rows });
    expect(confirmSeed).toHaveBeenCalledWith('u1', expect.any(Array), null);
  });

  it('takes no goal key at all, the same way', async () => {
    await call('/progress/repertoire/seed/confirm', { rows });
    expect(confirmSeed).toHaveBeenCalledWith('u1', expect.any(Array), null);
  });

  // The ruling, at the door: three standings, never the other two.
  for (const status of ['retired', 'learned', 'parked', 'Known', '']) {
    it(`400s on status "${status}" and writes nothing`, async () => {
      const r = await call('/progress/repertoire/seed/confirm', { rows: [{ label: 'Chanson', status }] });
      expect(r.status).toBe(400);
      expect(confirmSeed).not.toHaveBeenCalled();
    });
  }

  for (const status of ['known', 'working', 'queued']) {
    it(`accepts status "${status}"`, async () => {
      const r = await call('/progress/repertoire/seed/confirm', { rows: [{ label: 'Chanson', status }] });
      expect(r.status).toBe(200);
    });
  }

  it('400s past sixty rows, and writes nothing', async () => {
    const many = Array.from({ length: 61 }, (_, i) => ({ label: `Piece ${i}`, status: 'queued' }));
    const r = await call('/progress/repertoire/seed/confirm', { rows: many });
    expect(r.status).toBe(400);
    expect(confirmSeed).not.toHaveBeenCalled();
  });

  it('400s on an empty rows list rather than reporting a write of nothing', async () => {
    const r = await call('/progress/repertoire/seed/confirm', { rows: [] });
    expect(r.status).toBe(400);
    expect(confirmSeed).not.toHaveBeenCalled();
  });

  it('400s on a goal_id that is not a uuid', async () => {
    const r = await call('/progress/repertoire/seed/confirm', { goal_id: 'piano', rows });
    expect(r.status).toBe(400);
    expect(confirmSeed).not.toHaveBeenCalled();
  });

  // The refused rows are the whole point of reporting rather than dropping: the screen has to be
  // able to say WHICH name needs qualifying.
  it('carries the refused rows through with their labels and reasons', async () => {
    confirmSeed.mockResolvedValue({
      ok: true,
      written: 1,
      labels: ['Chanson'],
      refused: [{ label: 'Gavotte', reason: 'two of these carry the same name' }],
    });
    const r = await call('/progress/repertoire/seed/confirm', { rows });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      written: 1,
      labels: ['Chanson'],
      refused: [{ label: 'Gavotte', reason: 'two of these carry the same name' }],
    });
  });

  it('a fault answers 502, so "nothing saved" is never read as "nothing to save"', async () => {
    confirmSeed.mockResolvedValue({ ok: false, fault: 'a fault on our side' });
    const r = await call('/progress/repertoire/seed/confirm', { rows });
    expect(r.status).toBe(502);
    expect(String(r.body.error)).toMatch(/fault on our side/);
  });
});
