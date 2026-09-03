/**
 * The coach's door onto the seed, from the client's side: read the offer, and clear it.
 *
 * These two are the whole reason the chat can show anything at all — a tool call never reaches the
 * browser, so the offer travels as a pointer the client polls (the same rail
 * /plan/week-review/pending already runs on). What is worth pinning here is the failure shape: a
 * read that BROKE must answer "no offer" rather than 500ing a whole conversation over a card, and
 * clearing must be honest about failing, because a clear that silently did nothing puts the same
 * offer back on the next turn after the person said "not now".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';

const getUser = vi.fn();
const setPendingRepertoireReview = vi.fn(async (_id: string, _review: unknown) => undefined);

vi.mock('../repos/users.ts', () => ({
  getUser: (id: string) => getUser(id),
  setPendingRepertoireReview: (id: string, review: unknown) => setPendingRepertoireReview(id, review),
}));
vi.mock('../services/repertoire-seed.ts', () => ({ expandCollection: vi.fn(), confirmSeed: vi.fn() }));
vi.mock('../auth/middleware.ts', () => ({
  requireCadenceUser: (req: { cadenceUserId?: string }, _res: unknown, next: () => void) => {
    req.cadenceUserId = 'u1';
    next();
  },
}));

const { default: repertoireSeedRoutes } = await import('./repertoire-seed.ts');

const OFFER = {
  collection: 'Suzuki Piano Book 2',
  where_you_are: 'Hungarian Folk Song',
  goal_id: 'g-piano',
  offered_at: '2026-09-02T18:00:00.000Z',
};

async function call(method: 'GET' | 'POST', path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const app = express();
  app.use(express.json());
  app.use('/progress', repertoireSeedRoutes);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, { method });
    return { status: res.status, body: ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown> };
  } finally {
    server.close();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ pending_repertoire_review: OFFER });
});

describe('GET /progress/repertoire/seed/offer', () => {
  it('hands back the offer the coach put up', async () => {
    const res = await call('GET', '/progress/repertoire/seed/offer');
    expect(res.status).toBe(200);
    expect(res.body.offer).toEqual(OFFER);
    expect(getUser).toHaveBeenCalledWith('u1');
  });

  it('answers null when nothing is offered, rather than 404ing a card that simply is not due', async () => {
    getUser.mockResolvedValue({ pending_repertoire_review: null });
    const res = await call('GET', '/progress/repertoire/seed/offer');
    expect(res.status).toBe(200);
    expect(res.body.offer).toBeNull();
  });

  it('answers null on a pre-migration row, where the column is simply absent', async () => {
    getUser.mockResolvedValue({});
    const res = await call('GET', '/progress/repertoire/seed/offer');
    expect(res.body.offer).toBeNull();
  });

  it('answers null when the read throws — a missing card is not a broken conversation', async () => {
    getUser.mockRejectedValue(new Error('down'));
    const res = await call('GET', '/progress/repertoire/seed/offer');
    expect(res.status).toBe(200);
    expect(res.body.offer).toBeNull();
  });
});

describe('POST /progress/repertoire/seed/offer/clear', () => {
  it('clears the pointer, and writes nothing else', async () => {
    const res = await call('POST', '/progress/repertoire/seed/offer/clear');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(setPendingRepertoireReview).toHaveBeenCalledWith('u1', null);
  });

  it('says so when the clear fails, so the client does not report a dismissal that did not happen', async () => {
    setPendingRepertoireReview.mockRejectedValueOnce(new Error('down'));
    const res = await call('POST', '/progress/repertoire/seed/offer/clear');
    expect(res.status).toBe(500);
    expect(res.body.ok).toBeUndefined();
  });
});
