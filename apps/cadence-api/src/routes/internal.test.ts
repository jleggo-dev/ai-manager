/**
 * The tick endpoint's gate. Worth real tests because it is unauthenticated by design (a cron has
 * no session), so this file is the entire access control for something that can drain a user's
 * daily notification budget.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';

type TickShape = Awaited<ReturnType<typeof import('../services/notify/tick.ts').runTick>>;
const runTick = vi.fn(async (..._a: unknown[]): Promise<TickShape> => ({
  candidates: 0,
  sent: 0,
  skipped: 0,
  failed: 0,
  duplicate: 0,
  byKind: {},
  errors: [],
}));
let SECRET = 'right-secret';

vi.mock('../services/notify/tick.ts', () => ({ runTick: (...a: unknown[]) => runTick(...a) }));
// Mocked at the service seam so this file's minimal config mock never has to satisfy the
// synthesis pipeline's own imports (aim.ts reads config at module load).
const runSteeredRebalance = vi.fn(async (..._a: unknown[]) => ({ status: 'proposed' }));
vi.mock('../services/rebalance-run.ts', () => ({
  runSteeredRebalance: (...a: unknown[]) => runSteeredRebalance(...a),
}));
vi.mock('../config.ts', () => ({
  cadenceConfig: {
    get cronSecret() {
      return SECRET;
    },
  },
}));

const { default: internalRoutes } = await import('./internal.ts');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/internal', internalRoutes);
  return a;
}

/** Minimal fetch-through-express helper — avoids pulling supertest in for four assertions. */
async function post(headers: Record<string, string> = {}): Promise<{ status: number; body: unknown }> {
  const server = app().listen(0);
  const port = (server.address() as { port: number }).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/internal/notifications/tick`, { method: 'POST', headers });
    return { status: res.status, body: await res.json().catch(() => null) };
  } finally {
    server.close();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  SECRET = 'right-secret';
});

describe('POST /internal/notifications/tick', () => {
  it('runs the tick with a correct Bearer secret', async () => {
    const r = await post({ authorization: 'Bearer right-secret' });
    expect(r.status).toBe(200);
    expect(runTick).toHaveBeenCalledTimes(1);
  });

  it('accepts the x-cron-secret header too (GitHub Actions / curl convenience)', async () => {
    expect((await post({ 'x-cron-secret': 'right-secret' })).status).toBe(200);
    expect(runTick).toHaveBeenCalledTimes(1);
  });

  it('rejects a wrong secret without running anything', async () => {
    const r = await post({ authorization: 'Bearer wrong' });
    expect(r.status).toBe(401);
    expect(runTick).not.toHaveBeenCalled();
  });

  it('rejects a missing secret', async () => {
    expect((await post()).status).toBe(401);
    expect(runTick).not.toHaveBeenCalled();
  });

  it('FAILS CLOSED when the server has no secret configured', async () => {
    // The dangerous alternative is "nothing to check, so allow" — which turns a missing env var
    // in one environment into a public endpoint.
    SECRET = '';
    const r = await post({ authorization: 'Bearer anything' });
    expect(r.status).toBe(503);
    expect(runTick).not.toHaveBeenCalled();
  });

  it('reports producer errors in the body, not as a 5xx a cron would retry', async () => {
    runTick.mockResolvedValue({
      candidates: 2,
      sent: 1,
      skipped: 0,
      failed: 1,
      duplicate: 0,
      byKind: {},
      errors: ['producer x: boom'],
    });
    const r = await post({ authorization: 'Bearer right-secret' });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, sent: 1, errors: ['producer x: boom'] });
  });
});

/** Same gate, second door: the coach's dispatched rebalance (see rebalance-run.ts). */
describe('POST /internal/plan/rebalance', () => {
  async function postRebalance(
    headers: Record<string, string> = {},
    body?: unknown,
  ): Promise<{ status: number; body: unknown }> {
    const server = app().listen(0);
    const port = (server.address() as { port: number }).port;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/internal/plan/rebalance`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify(body ?? {}),
      });
      return { status: res.status, body: await res.json().catch(() => null) };
    } finally {
      server.close();
    }
  }

  it('runs the rebalance with a correct secret and a full body', async () => {
    const r = await postRebalance({ authorization: 'Bearer right-secret' }, { userId: 'u1', steer: 'more cardio' });
    expect(r.status).toBe(200);
    expect(runSteeredRebalance).toHaveBeenCalledWith('u1', 'more cardio');
  });

  it('rejects a wrong secret without touching the synthesis', async () => {
    const r = await postRebalance({ authorization: 'Bearer wrong' }, { userId: 'u1', steer: 'more cardio' });
    expect(r.status).toBe(401);
    expect(runSteeredRebalance).not.toHaveBeenCalled();
  });

  it('400s a body with no steer', async () => {
    const r = await postRebalance({ authorization: 'Bearer right-secret' }, { userId: 'u1' });
    expect(r.status).toBe(400);
    expect(runSteeredRebalance).not.toHaveBeenCalled();
  });
});
