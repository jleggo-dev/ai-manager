/**
 * The route is reachable through the REAL app, at the path the phone calls. Every other test here
 * mounts the router itself, so deleting the line in app.ts would leave them all green while every
 * save on every phone 404'd, silently, because the card treats a failed sync as nothing to mention.
 *
 * Signed in on purpose. Each `/me` router applies the auth check to everything passing through it,
 * so an anonymous request is a 401 whether this route is mounted or not: that would prove nothing.
 *
 * Faked: auth, and the database under every router the app loads.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Server } from 'node:http';

const pace = vi.hoisted(() => {
  // config.ts refuses to load without these. Placeholders: the database and auth are faked below,
  // so nothing here ever connects, with or without real values in the environment.
  process.env.CADENCE_DB_PASSWORD ||= 'unused-in-this-test';
  process.env.CADENCE_SUPABASE_URL ||= 'http://127.0.0.1:9';
  process.env.CADENCE_SUPABASE_ANON_KEY ||= 'unused-in-this-test';
  process.env.CADENCE_SUPABASE_SERVICE_ROLE_KEY ||= 'unused-in-this-test';
  return { value: 1.25 as number | null };
});

vi.mock('../db/sql.ts', () => {
  const fake = () => Promise.resolve([]);
  return { sql: Object.assign(fake, { json: (v: unknown) => v, unsafe: fake, begin: fake }), json: (v: unknown) => v };
});
vi.mock('../auth/middleware.ts', () => ({
  requireCadenceUser: (req: { cadenceUserId?: string }, _res: unknown, next: () => void) => {
    req.cadenceUserId = 'u1';
    next();
  },
}));
vi.mock('../repos/breath-pace.ts', () => ({
  getBreathPace: async () => pace.value,
  setBreathPace: async (_u: string, next: number) => {
    pace.value = next;
  },
}));

let server: Server;
let origin: string;

beforeAll(async () => {
  const { createApp } = await import('../app.ts');
  server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}, 60_000);
afterAll(() => {
  server?.close();
});

describe('/me/breath-pace in the real app', () => {
  it('reads what is stored', async () => {
    const res = await fetch(`${origin}/me/breath-pace`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ pace: 1.25 });
  });

  it('saves', async () => {
    const res = await fetch(`${origin}/me/breath-pace`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pace: 1.6 }),
    });
    expect(res.status).toBe(200);
    expect(pace.value).toBe(1.6);
  });

  it.each([['/me/breath-pace-nope'], ['/breath-pace']])('near miss: %s is not this route', async (path) => {
    expect((await fetch(`${origin}${path}`)).status).toBe(404);
  });
});
