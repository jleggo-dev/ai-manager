/**
 * Both sides of a button in one test: the web app's REAL lib/api functions calling a REAL router
 * over HTTP.
 *
 * Why this exists: every applied plan change said "That didn't take" for two months while it had
 * landed (found 2026-11-01). POST /plan/lock started answering 202; the change buttons demanded
 * 200. The route's tests asserted 202, the buttons' mocks said 200, and both were green, because
 * nothing ever handed a real server answer to the real client code. A `*.client.test.ts` file
 * does exactly that, and only fakes what sits BEHIND the route (repos, services) with `vi.mock`.
 * The contract under test is the HTTP one: which status, which body, and what the client makes
 * of it. Change either side's half of it and the test goes red.
 *
 * `vi.mock` calls stay in each test file (vitest hoists them per file); this is the rest of the
 * setup, which was the same every time.
 */
import { vi } from 'vitest';
import express, { type Express } from 'express';
import type { Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const WEB_API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../cadence-web/src/lib/api');

export interface ClientAgainstRoutes<Web> {
  /** The web client's module, as the phone runs it. */
  web: Web;
  /** Another lib/api module, pointed at the same server — for a screen that calls two. */
  load<Other>(webFile: string): Promise<Other>;
  close(): void;
}

/**
 * Serve the routers `mount` attaches (mount them where app.ts does), point the web client at that
 * server, and load the client module `webFile` (a file name under cadence-web/src/lib/api).
 *
 * The client is loaded by path at runtime so the API's typecheck never tries to compile browser
 * code — the caller describes the slice it uses with an interface (`Web`). The client builds
 * `${BASE}/...` with BASE = '/api' (Vercel strips it before the app sees the path) and reads
 * `window.location` to pick its auth header; both are pointed at this server. Call it in
 * `beforeAll`, and `close()` in `afterAll`.
 */
export async function serveRoutesToWebClient<Web>(
  webFile: string,
  mount: (app: Express) => void,
): Promise<ClientAgainstRoutes<Web>> {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  mount(app);
  const server: Server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  const realFetch = globalThis.fetch;
  vi.stubGlobal('window', { location: { search: '' } });
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => realFetch(origin + url.replace(/^\/api/, ''), init));

  const load = async <Other>(file: string) => (await import(/* @vite-ignore */ path.join(WEB_API_DIR, file))) as Other;
  return {
    web: await load<Web>(webFile),
    load,
    close() {
      server.close();
      vi.unstubAllGlobals();
    },
  };
}
