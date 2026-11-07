/**
 * The route where a pace tuned by feel becomes a stored fact. Worth pinning: a value outside the
 * person's range must never reach the column, and "never set" must read as null rather than as a
 * pace, because the card treats null as "keep what this phone has".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';

const getPace = vi.fn();
const setPace = vi.fn(async (..._a: unknown[]) => {});

vi.mock('../repos/breath-pace.ts', () => ({
  getBreathPace: (...a: unknown[]) => getPace(...a),
  setBreathPace: (...a: unknown[]) => setPace(...a),
}));
vi.mock('../auth/middleware.ts', () => ({
  // Turns away whoever the test marks anonymous, so a route that slipped out from behind the
  // check is caught. (Through the real app every /me router applies it: see *.mounted.test.ts.)
  requireCadenceUser: (
    req: { cadenceUserId?: string; headers: Record<string, unknown> },
    res: { status: (n: number) => { json: (b: unknown) => void } },
    next: () => void,
  ) => {
    if (req.headers['x-test-anonymous']) return void res.status(401).json({ error: 'Missing bearer token' });
    req.cadenceUserId = 'u1';
    next();
  },
}));

const { default: breathPaceRoutes } = await import('./breath-pace.ts');

async function call(
  method: 'GET' | 'PUT',
  body?: unknown,
  extraHeaders: Record<string, string> = {},
): Promise<{ status: number; json: { pace?: unknown } }> {
  const app = express();
  app.use(express.json());
  app.use('/me', breathPaceRoutes);
  const server = app.listen(0);
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/me/breath-pace`, {
      method,
      headers: { 'content-type': 'application/json', ...extraHeaders },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: res.status, json: (await res.json()) as { pace?: unknown } };
  } finally {
    server.close();
  }
}

describe('/me/breath-pace', () => {
  beforeEach(() => {
    getPace.mockReset();
    setPace.mockClear();
    setPace.mockImplementation(async () => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it.each([
    [null, null], // never set
    [1.37, 1.37],
  ])('GET reads a stored %s as %s', async (stored, pace) => {
    getPace.mockResolvedValue(stored);
    const res = await call('GET');
    expect(res.status).toBe(200);
    expect(res.json.pace).toBe(pace);
    expect(getPace).toHaveBeenCalledWith('u1');
  });

  it.each([[0.75], [1], [1.37], [2]])('PUT stores %f, any point on the track', async (pace) => {
    const res = await call('PUT', { pace });
    expect(res.status).toBe(200);
    expect(res.json.pace).toBe(pace);
    expect(setPace).toHaveBeenCalledWith('u1', pace);
  });

  it.each([
    ['just under the range', { pace: 0.74 }],
    ['just over the range', { pace: 2.01 }],
    ['zero', { pace: 0 }],
    ['negative', { pace: -1 }],
    ['a string that looks like a pace', { pace: '1.2' }],
    ['null', { pace: null }],
    ['nothing', {}],
  ])('PUT refuses %s and stores nothing', async (_name, body) => {
    const res = await call('PUT', body);
    expect(res.status).toBe(400);
    expect(setPace).not.toHaveBeenCalled();
  });

  it.each<['GET' | 'PUT', unknown]>([
    ['GET', undefined],
    ['PUT', { pace: 1.5 }],
  ])('%s stays behind the auth check and touches nothing for the anonymous', async (method, body) => {
    const res = await call(method, body, { 'x-test-anonymous': '1' });
    expect(res.status).toBe(401);
    expect(getPace).not.toHaveBeenCalled();
    expect(setPace).not.toHaveBeenCalled();
  });

  it('a database failure reads as a failure, never as "no pace set"', async () => {
    getPace.mockRejectedValue(new Error('down'));
    expect((await call('GET')).status).toBe(500);
    setPace.mockRejectedValue(new Error('down'));
    expect((await call('PUT', { pace: 1.5 })).status).toBe(500);
  });
});
