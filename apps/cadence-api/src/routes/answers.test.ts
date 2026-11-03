/**
 * GET /answers/:request_id and `answerKept` — the answer to a long request the client could not
 * stay for (services/kept-answers.ts), against a faked row store.
 *
 * The contract under test is the one the phone's recovery runs on: which word comes back for
 * which row, that a second request under a running id joins the run instead of starting another,
 * and that the fault kept for the client who left is the fault the client who stayed was sent.
 * The sibling route here stands in for nutrition.ts's four read routes, wired the same way.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express, { type Request, type Response } from 'express';
import type { Server } from 'node:http';
import { backdateKeptAnswer, resetKeptAnswers, rows } from '../test/kept-answers-fake.ts';

vi.mock('../repos/kept-answers.ts', () => import('../test/kept-answers-fake.ts'));
vi.mock('../services/background.ts', () => ({ runInBackground: () => {} }));
vi.mock('../auth/middleware.ts', () => ({
  requireCadenceUser: (req: Request & { cadenceUserId?: string }, _res: unknown, next: () => void) => {
    req.cadenceUserId = (req.headers['x-user'] as string | undefined) ?? 'u1';
    next();
  },
}));

const { default: answersRoutes, answerKept } = await import('./answers.ts');
const { statusOf, RUNNING_MAX_MS } = await import('../services/kept-answers.ts');
const { requireCadenceUser } = await import('../auth/middleware.ts');

/** The read behind the sibling route: settled by the test, so a request can be caught mid-run. */
let runs = 0;
let release: (answer: unknown) => void = () => {};
let refuse: (fault: { status: number; message: string }) => void = () => {};
let onRun: (() => void) | null = null;
/** Resolves when the next run begins — the moment the route has claimed its row and is working. */
const nextRun = () => new Promise<void>((r) => (onRun = r));
const work = () =>
  new Promise<unknown>((resolve, reject) => {
    runs += 1;
    release = resolve;
    refuse = (f) => reject(Object.assign(new Error(f.message), { status: f.status }));
    onRun?.();
    onRun = null;
  });

const app = express();
app.use(express.json());
app.use('/answers', answersRoutes);
app.post('/read', requireCadenceUser, async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  // The same shape nutrition.ts uses: the fault rule serves both the live answer and the kept one.
  const faultOf = (err: unknown) => ({
    status: (err as { status?: number }).status ?? 500,
    error: (err as Error).message,
  });
  try {
    await answerKept(res, { userId, requestId: req.body.request_id, kind: 'meal_preview' }, work, faultOf);
  } catch (err) {
    const f = faultOf(err);
    res.status(f.status).json({ error: f.error });
  }
});

let server: Server;
let origin = '';
beforeAll(async () => {
  server = app.listen(0);
  await new Promise<void>((r) => server.once('listening', () => r()));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterAll(() => {
  server.closeAllConnections();
  server.close();
});
beforeEach(() => {
  resetKeptAnswers();
  runs = 0;
});

const ID = '3f2c9b1e-4d5a-4c6b-8e7f-1a2b3c4d5e6f';
const post = (body: Record<string, unknown>, user = 'u1') =>
  fetch(`${origin}/read`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-user': user },
    body: JSON.stringify(body),
  });
const ask = async (id: string, user = 'u1') => {
  const res = await fetch(`${origin}/answers/${id}`, { headers: { 'x-user': user } });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
};

describe('answerKept — a long request under its client-made id', () => {
  it('without a request id, the work answers as it always did', async () => {
    const begun = nextRun();
    const pending = post({ text: 'a banana' });
    await begun;
    release({ items: ['banana'] });
    const res = await pending;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: ['banana'] });
    expect(rows.size).toBe(0);
  });

  it('keeps the answer before sending it, and a second request under the same id joins the run instead of starting another', async () => {
    const begun = nextRun();
    const first = post({ text: 'a pint of beer', request_id: ID });
    await begun;
    // The client re-sent — it could not tell whether the first one arrived. Still one run.
    const again = await post({ text: 'a pint of beer', request_id: ID });
    expect(again.status).toBe(202);
    expect(await again.json()).toMatchObject({ status: 'running' });
    expect((await ask(ID)).body).toMatchObject({ status: 'running' });
    expect(runs).toBe(1);

    release({ items: ['beer'] });
    const res = await first;
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ items: ['beer'] });
    // The row holds the answer the live client got — and a third request is answered from it.
    expect((await ask(ID)).body).toEqual({ status: 'done', answer: { items: ['beer'] } });
    const third = await post({ text: 'a pint of beer', request_id: ID });
    expect(third.status).toBe(200);
    expect(await third.json()).toEqual({ items: ['beer'] });
    expect(runs).toBe(1);
  });

  it('keeps a refusal as the fault the live client was sent — same status, same line, and no second run', async () => {
    const begun = nextRun();
    const first = post({ text: 'x', request_id: ID });
    await begun;
    refuse({ status: 400, message: 'a meal needs words' });
    const res = await first;
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'a meal needs words' });

    expect((await ask(ID)).body).toEqual({ status: 'failed', fault: { status: 400, error: 'a meal needs words' } });
    const again = await post({ text: 'x', request_id: ID });
    expect(again.status).toBe(400);
    expect(await again.json()).toEqual({ error: 'a meal needs words' });
    expect(runs).toBe(1);
  });

  it('a run that never finished reads as lost once it is older than RUNNING_MAX_MS; a re-send under its id starts over', async () => {
    const begunDead = nextRun();
    const dead = post({ text: 'a coffee', request_id: ID }).catch(() => null);
    await begunDead;
    const releaseDead = release;
    expect((await ask(ID)).body).toMatchObject({ status: 'running' });

    backdateKeptAnswer('u1', ID, RUNNING_MAX_MS + 1_000);
    expect((await ask(ID)).body).toEqual({ status: 'lost' });

    // The id is claimed again — a fresh run, not the corpse's row.
    const begunRetry = nextRun();
    const retry = post({ text: 'a coffee', request_id: ID });
    await begunRetry;
    expect(runs).toBe(2);
    release({ items: ['coffee'] });
    expect(await (await retry).json()).toEqual({ items: ['coffee'] });
    expect((await ask(ID)).body).toEqual({ status: 'done', answer: { items: ['coffee'] } });
    releaseDead({ items: ['late'] });
    await dead;
  });

  it('an id the server never saw is unknown; one that is not a uuid is refused', async () => {
    expect((await ask('7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d')).body).toEqual({ status: 'unknown' });
    const bad = await ask('not-an-id');
    expect(bad.status).toBe(400);
  });

  it('another person asking after the id sees nothing — the row is theirs alone', async () => {
    const begun = nextRun();
    const first = post({ text: 'a banana', request_id: ID });
    await begun;
    release({ items: ['banana'] });
    await first;
    expect((await ask(ID, 'u2')).body).toEqual({ status: 'unknown' });
    expect((await ask(ID, 'u1')).body).toMatchObject({ status: 'done' });
  });
});

describe('statusOf — what a row means to the client asking after it', () => {
  const at = new Date('2026-11-03T20:00:00Z');
  const now = at.getTime();
  type Row = Parameters<typeof statusOf>[0] & object;
  const row = (over: Partial<Row>): Row => ({
    request_id: ID,
    kind: 'meal_preview',
    status: 'running',
    answer: null,
    fault: null,
    started_at: at,
    finished_at: null,
    ...over,
  });

  it.each([
    ['no row → unknown (the request never arrived: re-send it)', null, { status: 'unknown' }],
    ['done → the answer', row({ status: 'done', answer: { items: [] } }), { status: 'done', answer: { items: [] } }],
    [
      'failed → the fault',
      row({ status: 'failed', fault: { status: 400, error: 'no' } }),
      { status: 'failed', fault: { status: 400, error: 'no' } },
    ],
    [
      'failed with no fault written → a fault all the same, never an empty answer',
      row({ status: 'failed' }),
      { status: 'failed', fault: { status: 500, error: 'that request failed' } },
    ],
    ['running, started just now → running', row({}), { status: 'running', started_at: at.toISOString() }],
    [
      'running, started as a string (a test or a driver) → still read',
      row({ started_at: at.toISOString() }),
      { status: 'running', started_at: at.toISOString() },
    ],
    [
      'running past RUNNING_MAX_MS → lost (the instance died with it)',
      row({ started_at: new Date(now - RUNNING_MAX_MS - 1) }),
      { status: 'lost' },
    ],
    ['running with an unreadable start → lost, not running forever', row({ started_at: 'eh' }), { status: 'lost' }],
  ])('%s', (_name, input, expected) => {
    expect(statusOf(input, now)).toEqual(expected);
  });
});
