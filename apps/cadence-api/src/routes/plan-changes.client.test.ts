/**
 * The phone's change buttons against the REAL routes they call — both sides at once.
 *
 * Every applied change said "That didn't take" for two months while it had landed (found
 * 2026-11-01). POST /plan/lock started answering 202; the buttons demanded 200. Each side had its
 * own green tests: the route's asserted 202, the buttons' mocked lockPlan to return 200. Nothing
 * ever handed a real server answer to the real client code, so the two could disagree forever.
 *
 * This file does exactly that: the web app's own lib/api functions (imported from cadence-web, not
 * re-implemented) call the real plan-changes router over HTTP. Only what sits BEHIND the route is
 * faked — the account row (an in-memory pending change) and the commit itself — because the
 * contract under test is the HTTP one: which status, which body, and what the client makes of it.
 * Change either side's half of that and this goes red.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import express from 'express';
import type { Server } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PendingPlan } from '@cadence/shared';

/** The account behind the route: what's pending, and the plan version it last committed. */
const account: { pending_plan: PendingPlan | null; version: number } = { pending_plan: null, version: 29 };

vi.mock('../repos/users.ts', () => ({
  getUser: async () => ({ pending_plan: account.pending_plan }),
  setPendingPlan: async (_u: string, p: PendingPlan | null) => {
    account.pending_plan = p;
  },
}));
vi.mock('../services/plan-change-detail.ts', () => ({
  buildPendingChangeDetail: async () => ({
    plan_version: account.version,
    items: (account.pending_plan?.activities ?? []).map((a, index) => ({
      index,
      title: a.title,
      enabled: a.enabled !== false,
      now: null,
      next: a.cadence,
    })),
  }),
}));
vi.mock('../services/lock.ts', () => ({
  CHANGE_EXPIRED: 'That change card expired — ask me again and I will put it back up.',
  // The commit, as confirmLock does it for a stored change: write the version, clear the card.
  confirmLock: async () => {
    if (account.pending_plan?.activities.some((a) => a.title === 'Refused by the check')) {
      return { status: 'vetoed', violations: ['Two long runs on Monday'] };
    }
    account.pending_plan = null;
    account.version += 1;
    return { status: 'committed', version: account.version };
  },
}));
vi.mock('../auth/middleware.ts', () => ({
  requireCadenceUser: (req: { cadenceUserId?: string }, _res: unknown, next: () => void) => {
    req.cadenceUserId = 'u1';
    next();
  },
}));

/** The web client's real functions. Loaded by path at runtime so the API's typecheck does not try
 *  to compile browser code; this interface is the slice of it under test. */
interface WebPlanApi {
  applyPendingChange(): Promise<{ ok: true } | { ok: false; message: string | null }>;
  setPendingChangeToggles(toggles: { index: number; enabled: boolean }[]): Promise<boolean>;
  getPendingChangeDetail(): Promise<{ plan_version: number | null; items: { index: number; enabled: boolean }[] }>;
}
const WEB_PLAN_API = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../cadence-web/src/lib/api/plan.ts',
);

const { default: planChangesRoutes } = await import('./plan-changes.ts');
let web: WebPlanApi;
let server: Server;

beforeAll(async () => {
  // Mounted where app.ts mounts it.
  const app = express();
  app.use(express.json());
  app.use('/plan', planChangesRoutes);
  server = app.listen(0);
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  // The client builds `${BASE}/plan/...` with BASE = '/api' (Vercel strips it before the app sees
  // the path) and reads `window.location` to pick its auth header. Point both at this server.
  const realFetch = globalThis.fetch;
  vi.stubGlobal('window', { location: { search: '' } });
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => realFetch(origin + url.replace(/^\/api/, ''), init));

  web = (await import(/* @vite-ignore */ WEB_PLAN_API)) as WebPlanApi;
});
afterAll(() => {
  server.close();
  vi.unstubAllGlobals();
});

function pending(...titles: string[]): PendingPlan {
  return {
    activities: titles.map((title) => ({
      title,
      kind: 'user',
      cadence: 'Mon',
      recurrence: 'FREQ=WEEKLY;BYDAY=MO',
      completion_source: 'self_report',
    })),
    note: 'n',
    goal_ids: [],
    created_at: '2026-11-01T18:00:00.000Z',
  };
}

beforeEach(() => {
  account.pending_plan = pending('Long run', 'Weighted ruck');
  account.version = 29;
});

describe('the change buttons against the real plan-changes routes', () => {
  it('an apply that lands reads as landed — the bug was a landed change reading as failed', async () => {
    expect(await web.applyPendingChange()).toEqual({ ok: true });
    expect(account.version).toBe(30);
    expect(account.pending_plan).toBeNull();
  });

  it("the sheet's whole sequence: read the detail, persist a flip, apply", async () => {
    const detail = await web.getPendingChangeDetail();
    expect(detail.plan_version).toBe(29);
    expect(detail.items.map((i) => i.index)).toEqual([0, 1]);

    expect(await web.setPendingChangeToggles([{ index: 1, enabled: false }])).toBe(true);
    expect(account.pending_plan!.activities[1]!.enabled).toBe(false);

    expect(await web.applyPendingChange()).toEqual({ ok: true });
  });

  it('a second tap after it landed is a refusal in the words the person sees, not a generic failure', async () => {
    await web.applyPendingChange();
    expect(await web.applyPendingChange()).toEqual({
      ok: false,
      message: 'That change card expired — ask me again and I will put it back up.',
    });
    expect(account.version).toBe(30); // nothing committed twice
  });

  it("a refused commit reaches the client in the check's own words", async () => {
    account.pending_plan = pending('Refused by the check');
    expect(await web.applyPendingChange()).toEqual({ ok: false, message: 'Two long runs on Monday' });
  });

  it('a flip aimed at a row that is not there is refused, not silently dropped', async () => {
    expect(await web.setPendingChangeToggles([{ index: 7, enabled: true }])).toBe(false);
  });

  it('with nothing pending, the detail is an empty list — the sheet shows its "nothing to change" line', async () => {
    account.pending_plan = null;
    const detail = await web.getPendingChangeDetail();
    expect(detail.items).toEqual([]);
  });
});
