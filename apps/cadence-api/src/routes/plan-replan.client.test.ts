/**
 * The plan's long-running buttons against the REAL routes they call — both sides at once (the
 * shape and the reason: src/test/client-route.ts).
 *
 * Every route in plan-replan.ts starts or answers a background plan run: the first build
 * ("Set your rhythm", POST /plan/lock), Adjust my plan (preview, then confirm), and the coach's
 * weekly proposal (accept, dismiss). They answer 202 and the phone polls, which is exactly the
 * kind of answer the change buttons misread for two months. So each flow here runs the way its
 * screen runs it — start, poll, see how it ended — with the web app's own lib/api functions, and
 * asserts the fields the screen branches on (useBuildPlan, useReplanPreview, AdjustSheet,
 * useProposalAccept).
 *
 * plan-run.ts and replan-start.ts run REAL: the run record they write is what the poll reads.
 * Faked: the account row (in memory), the synthesis and commit services, push, and the
 * background runner (held, so a test can poll while the run is still going, then let it finish).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import type { PendingPlan, PendingPlanActivity, PlanRunStage } from '@cadence/shared';
import type { PlanRun } from '../repos/users.ts';
import { serveRoutesToWebClient, type ClientAgainstRoutes } from '../test/client-route.ts';

/** The account behind the routes. */
const account: {
  plan_run: PlanRun | null;
  pending_plan: PendingPlan | null;
  pending_proposal: { reason: string; action?: 'replan' | 'enter_disrupted' | 'rebaseline' } | null;
  plan_version: number | null;
} = { plan_run: null, pending_plan: null, pending_proposal: null, plan_version: null };

/** How the faked synthesis ends this time. */
let outcome: 'commits' | 'too_many_goals' | 'vetoed' | 'crashes' = 'commits';
/** Background work the routes started, and the synthesis steps waiting inside it. A run stays
 *  "running" until `finishRuns()` lets every waiting step go and waits for the record to settle. */
let held: Promise<unknown>[] = [];
let waiting: (() => void)[] = [];
async function finishRuns() {
  for (const go of waiting.splice(0)) go();
  await Promise.all(held.splice(0));
}
/** Each faked synthesis waits here, so "still running" is a real state the poll can see. */
function working(): Promise<void> {
  return new Promise<void>((resolve) => void waiting.push(resolve));
}

vi.mock('../auth/middleware.ts', () => ({
  requireCadenceUser: (req: { cadenceUserId?: string }, _res: unknown, next: () => void) => {
    req.cadenceUserId = 'u1';
    next();
  },
}));
vi.mock('../repos/users.ts', () => ({
  PLAN_RUN_STALE_MINUTES: 15,
  getUser: async () => ({ ...account }),
  setPendingProposal: async (_u: string, p: typeof account.pending_proposal) => {
    account.pending_proposal = p;
  },
  setPlanRun: async (_u: string, run: PlanRun | null) => {
    account.plan_run = run;
  },
  // The real claim is one atomic UPDATE; this is the same rule: a live run cannot be claimed twice.
  claimPlanRun: async (_u: string, run: PlanRun) => {
    if (account.plan_run?.status === 'running') return false;
    account.plan_run = run;
    return true;
  },
  setPlanRunStage: async (_u: string, stage: PlanRunStage) => {
    if (account.plan_run?.status === 'running') account.plan_run = { ...account.plan_run, stage };
  },
  setPlanRunDrafted: async () => {},
}));
vi.mock('../repos/plans.ts', () => ({
  getActivePlan: async () => (account.plan_version === null ? null : { version: account.plan_version }),
}));
vi.mock('../services/background.ts', () => ({
  runInBackground: (_label: string, work: Promise<unknown>) => void held.push(work),
}));
vi.mock('../services/plan-ready-push.ts', () => ({ sendPlanReadyPush: async () => {} }));

/** The synthesis and the commit, as the real services report them. */
function synthesisResult() {
  if (outcome === 'crashes') throw new Error('provider timed out');
  if (outcome === 'too_many_goals') {
    return { status: 'needs_focus' as const, guardrail: { weightedLoad: 9, activeCount: 7 } };
  }
  if (outcome === 'vetoed') return { status: 'vetoed' as const, violations: ['Two long runs on Monday'] };
  return null;
}
function commit() {
  account.plan_version = (account.plan_version ?? 0) + 1;
  return { status: 'committed' as const, version: account.plan_version, note: 'Moved the long run to Saturday.' };
}
vi.mock('../services/lock.ts', () => ({
  confirmLock: async () => {
    await working();
    return synthesisResult() ?? commit();
  },
}));
vi.mock('../services/replan.ts', () => ({
  REBASELINE_STEER: 'start fresh',
  previewReplan: async () => {
    await working();
    const refused = synthesisResult();
    if (refused) return refused;
    account.pending_plan = proposalPlan();
    return { status: 'proposed', proposal: { activities: account.pending_plan.activities, note: 'n' } };
  },
  replanPlan: async () => {
    await working();
    const refused = synthesisResult();
    if (refused) return refused;
    account.pending_proposal = null;
    return { ...commit(), planId: 'p2' };
  },
  confirmReplan: async () => {
    if (!account.pending_plan) {
      return { status: 'vetoed', violations: ['That adjustment expired — run the preview again.'] };
    }
    account.pending_plan = null;
    return commit();
  },
  dismissReplan: async () => {
    account.pending_plan = null;
  },
}));
vi.mock('../services/episode.ts', () => ({
  enterEpisode: async () => (account.plan_version === null ? null : { episode: { type: 'travel' } }),
}));

function proposalPlan(): PendingPlan {
  const run: PendingPlanActivity = {
    title: 'Long run',
    kind: 'user',
    cadence: 'Sat',
    recurrence: 'FREQ=WEEKLY;BYDAY=SA',
    completion_source: 'self_report',
  };
  return { activities: [run], note: 'n', goal_ids: [], created_at: '2026-11-01T18:00:00.000Z' };
}

/** The slice of the web client's lib/api/plan.ts these screens use. */
interface WebPlanApi {
  lockPlan(): Promise<{ ok: true } | { ok: false; message: string | null }>;
  getBuildRun(): Promise<{
    ok: boolean;
    committed: boolean;
    running?: { stage: PlanRunStage };
    failed?: { message: string };
  }>;
  previewReplan(steer?: string): Promise<{ ok: boolean; running?: boolean; joined?: boolean; invalid?: boolean }>;
  getPendingReplan(): Promise<{
    ok: boolean;
    proposal: { activities: PendingPlanActivity[] } | null;
    running?: { stage: PlanRunStage };
    failed?: { message: string };
  }>;
  dismissReplanPreview(): Promise<void>;
  replan(): Promise<{ status: string; note?: string; violations?: string[] }>;
  acceptProposal(): Promise<{ status: string; running?: boolean }>;
  dismissProposal(): Promise<void>;
}

const { default: planReplanRoutes } = await import('./plan-replan.ts');
let served: ClientAgainstRoutes<WebPlanApi>;
let web: WebPlanApi;

beforeAll(async () => {
  served = await serveRoutesToWebClient<WebPlanApi>('plan.ts', (app) => app.use('/plan', planReplanRoutes));
  web = served.web;
});
afterAll(() => served.close());

beforeEach(() => {
  account.plan_run = null;
  account.pending_plan = null;
  account.pending_proposal = null;
  account.plan_version = null;
  outcome = 'commits';
  held = [];
  waiting = [];
});

describe('the first build (useBuildPlan) against POST /plan/lock and GET /plan/build', () => {
  it('a claimed build reads as started, the poll sees it running, then sees the plan', async () => {
    expect(await web.lockPlan()).toEqual({ ok: true });
    const meanwhile = await web.getBuildRun();
    expect(meanwhile).toMatchObject({ ok: true, committed: false, running: { stage: 'reading' } });

    await finishRuns();
    expect(await web.getBuildRun()).toMatchObject({ ok: true, committed: true });
  });

  it('a second tap while it builds joins the same run — still read as started, no second build', async () => {
    await web.lockPlan();
    expect(await web.lockPlan()).toEqual({ ok: true });
    expect(held).toHaveLength(1);
    await finishRuns();
    expect(account.plan_version).toBe(1);
  });

  it('too many goals arrives through the poll in the server\'s words — never as a "started" that hangs', async () => {
    outcome = 'too_many_goals';
    expect(await web.lockPlan()).toEqual({ ok: true });
    await finishRuns();
    expect(await web.getBuildRun()).toEqual({
      ok: true,
      committed: false,
      running: undefined,
      failed: { message: 'Too many goals at once — trim the list and try again.' },
    });
  });

  it("a failed plan check arrives through the poll in the check's words", async () => {
    outcome = 'vetoed';
    await web.lockPlan();
    await finishRuns();
    expect((await web.getBuildRun()).failed).toEqual({ message: 'Two long runs on Monday' });
  });

  it('a build that crashes is a failure on the poll, not a spinner forever', async () => {
    outcome = 'crashes';
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await web.lockPlan();
    await finishRuns();
    expect((await web.getBuildRun()).failed?.message).toMatch(/went wrong/);
  });
});

describe('Adjust my plan (useReplanPreview, AdjustSheet) against the replan routes', () => {
  it('preview starts a run, the poll narrates it, then hands back the proposal; confirm commits it', async () => {
    expect(await web.previewReplan('lighter week')).toEqual({ ok: true, running: true, joined: false });
    expect(await web.getPendingReplan()).toMatchObject({ ok: true, proposal: null, running: { stage: 'reading' } });

    await finishRuns();
    const ready = await web.getPendingReplan();
    expect(ready.ok).toBe(true);
    expect(ready.proposal?.activities.map((a) => a.title)).toEqual(['Long run']);

    // AdjustSheet's Apply: `status === 'committed'` is what closes the sheet with her note.
    expect(await web.replan()).toMatchObject({ status: 'committed', note: 'Moved the long run to Saturday.' });
    expect(account.plan_version).toBe(1);
  });

  it('a second preview tap while one runs joins it', async () => {
    await web.previewReplan();
    expect(await web.previewReplan()).toEqual({ ok: true, running: true, joined: true });
    expect(held).toHaveLength(1);
  });

  it('an over-long steer still starts a run (the route clips it) — the sheet polls, it does not stop', async () => {
    // The sheet stops on `invalid` (a 400). The client only ever sends a string steer, and the
    // route clips one to 500 characters rather than refusing it, so a long note must not stop it.
    expect(await web.previewReplan('x'.repeat(5000))).toEqual({ ok: true, running: true, joined: false });
    expect(held).toHaveLength(1);
  });

  it("a refused synthesis reaches the sheet as a failure in the server's words", async () => {
    outcome = 'vetoed';
    await web.previewReplan();
    await finishRuns();
    expect(await web.getPendingReplan()).toMatchObject({
      ok: true,
      proposal: null,
      failed: { message: 'Two long runs on Monday' },
    });
  });

  it("confirming an expired preview reads as 'vetoed' with the reason — the sheet shows it", async () => {
    expect(await web.replan()).toMatchObject({
      status: 'vetoed',
      violations: ['That adjustment expired — run the preview again.'],
    });
  });

  it('dismiss clears the proposal and the run, so the poll answers "nothing going on"', async () => {
    outcome = 'vetoed';
    await web.previewReplan();
    await finishRuns();
    await web.dismissReplanPreview();
    expect(await web.getPendingReplan()).toEqual({
      ok: true,
      proposal: null,
      running: undefined,
      failed: undefined,
    });
  });
});

describe("the coach's weekly proposal (useProposalAccept) against /plan/proposal/*", () => {
  beforeEach(() => {
    account.plan_version = 4;
    account.pending_proposal = { reason: 'Three missed runs', action: 'replan' };
  });

  it('accept starts the run (running: true), the poll shows it, and it ends committed with nothing left', async () => {
    expect(await web.acceptProposal()).toMatchObject({ running: true });
    expect((await web.getPendingReplan()).running).toBeDefined();

    await finishRuns();
    // The banner's "landed" branch: ok, no proposal, nothing running, nothing failed.
    expect(await web.getPendingReplan()).toEqual({
      ok: true,
      proposal: null,
      running: undefined,
      failed: undefined,
    });
    expect(account.plan_version).toBe(5);
    expect(account.pending_proposal).toBeNull();
  });

  it('a refused accept comes back through the poll, so the buttons come back with the reason', async () => {
    outcome = 'vetoed';
    await web.acceptProposal();
    await finishRuns();
    expect((await web.getPendingReplan()).failed).toEqual({ message: 'Two long runs on Monday' });
  });

  it("a detour proposal is entered on the spot and says so ('entered_disrupted')", async () => {
    account.pending_proposal = { reason: 'Away next week', action: 'enter_disrupted' };
    expect(await web.acceptProposal()).toMatchObject({ status: 'entered_disrupted' });
    expect(held).toHaveLength(0);
  });

  it('a detour with no plan to put it over is a refusal, not a silent success', async () => {
    account.plan_version = null;
    account.pending_proposal = { reason: 'Away next week', action: 'enter_disrupted' };
    const r = await web.acceptProposal();
    expect(r.status).toBe('no_plan');
    expect(r.running).toBeUndefined();
  });

  it('dismiss drops the proposal', async () => {
    await web.dismissProposal();
    expect(account.pending_proposal).toBeNull();
  });
});
