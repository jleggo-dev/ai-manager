/**
 * The background-run route contract (Phase 0, docs/cadence/PLAN-CHANGES.md): preview and accept
 * reply 202 and never block on synthesis; repeat taps join instead of re-firing; the pending poll
 * reports exactly one of proposal | running | failed | nothing. Same express-on-an-ephemeral-port
 * harness as plan-changes.test.ts. plan-run.ts itself runs REAL here (only its repo/push/background
 * seams are mocked), so these tests cover the derivation the client actually gets.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';

const getUser = vi.fn();
const setPendingProposal = vi.fn(async (..._a: unknown[]) => {});
const setPlanRun = vi.fn(async (..._a: unknown[]) => {});
const claimPlanRun = vi.fn();
const setPlanRunStage = vi.fn(async (..._a: unknown[]) => {});
const previewReplan = vi.fn();
const replanPlan = vi.fn();
const confirmReplan = vi.fn();
const dismissReplan = vi.fn(async (..._a: unknown[]) => {});
const enterEpisode = vi.fn();
const sendPlanReadyPush = vi.fn(async (..._a: unknown[]) => {});
const background: Promise<unknown>[] = [];

vi.mock('../auth/middleware.ts', () => ({
  requireCadenceUser: (req: { cadenceUserId?: string }, _res: unknown, next: () => void) => {
    req.cadenceUserId = 'u1';
    next();
  },
}));
vi.mock('../repos/users.ts', () => ({
  PLAN_RUN_STALE_MINUTES: 15,
  getUser: (...a: unknown[]) => getUser(...a),
  setPendingProposal: (...a: unknown[]) => setPendingProposal(...a),
  setPlanRun: (...a: unknown[]) => setPlanRun(...a),
  claimPlanRun: (...a: unknown[]) => claimPlanRun(...a),
  setPlanRunStage: (...a: unknown[]) => setPlanRunStage(...a),
}));
vi.mock('../services/replan.ts', () => ({
  previewReplan: (...a: unknown[]) => previewReplan(...a),
  replanPlan: (...a: unknown[]) => replanPlan(...a),
  confirmReplan: (...a: unknown[]) => confirmReplan(...a),
  dismissReplan: (...a: unknown[]) => dismissReplan(...a),
  REBASELINE_STEER: 'rebaseline-steer',
}));
vi.mock('../services/episode.ts', () => ({ enterEpisode: (...a: unknown[]) => enterEpisode(...a) }));
vi.mock('../services/plan-ready-push.ts', () => ({ sendPlanReadyPush: (...a: unknown[]) => sendPlanReadyPush(...a) }));
vi.mock('../services/background.ts', () => ({
  runInBackground: (_label: string, work: Promise<unknown>) => void background.push(work),
}));

const { default: planReplanRoutes } = await import('./plan-replan.ts');

interface RouteResponse {
  status: number;
  body: Record<string, unknown>;
}

async function call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<RouteResponse> {
  const app = express();
  app.use(express.json());
  app.use('/plan', planReplanRoutes);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      method,
      ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown> };
  } finally {
    server.close();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  background.length = 0;
  claimPlanRun.mockResolvedValue(true);
  getUser.mockResolvedValue({ pending_plan: null, pending_proposal: null, plan_run: null });
});

describe('POST /plan/replan/preview', () => {
  it('replies 202 {running:true} immediately and runs the preview in the background', async () => {
    previewReplan.mockResolvedValue({ status: 'proposed', proposal: { activities: [], note: '' } });
    const r = await call('POST', '/plan/replan/preview', { steer: 'one run day is not enough' });
    expect(r.status).toBe(202);
    expect(r.body).toEqual({ running: true });
    await Promise.all(background);
    expect(previewReplan).toHaveBeenCalledWith('u1', 'one run day is not enough', expect.any(Function));
  });

  it('joins a run already in flight instead of re-firing — 202 {running:true, joined:true}', async () => {
    claimPlanRun.mockResolvedValue(false);
    const r = await call('POST', '/plan/replan/preview', {});
    expect(r.status).toBe(202);
    expect(r.body).toEqual({ running: true, joined: true });
    expect(previewReplan).not.toHaveBeenCalled();
  });

  it('still rejects an invalid body with 400, before any run is claimed', async () => {
    const r = await call('POST', '/plan/replan/preview', { steer: 123 });
    expect(r.status).toBe(400);
    expect(claimPlanRun).not.toHaveBeenCalled();
  });
});

describe('GET /plan/replan/pending', () => {
  it('a stored pending_plan wins over any run record', async () => {
    getUser.mockResolvedValue({
      pending_plan: { activities: [], note: 'n', rationale: 'r', goal_ids: [], created_at: 'c' },
      plan_run: { kind: 'replan_preview', status: 'running', started_at: new Date().toISOString() },
    });
    const r = await call('GET', '/plan/replan/pending');
    expect(r.body).toEqual({ proposal: { activities: [], note: 'n', rationale: 'r' } });
  });

  it('reports a fresh run as running with its stage', async () => {
    const startedAt = new Date(Date.now() - 60_000).toISOString();
    getUser.mockResolvedValue({
      pending_plan: null,
      plan_run: { kind: 'replan_preview', status: 'running', stage: 'drafting', started_at: startedAt },
    });
    const r = await call('GET', '/plan/replan/pending');
    expect(r.body).toEqual({ proposal: null, running: { stage: 'drafting', startedAt } });
  });

  it('reports a failed run with its message', async () => {
    getUser.mockResolvedValue({
      pending_plan: null,
      plan_run: { kind: 'replan_preview', status: 'failed', started_at: 'x', error: 'vet said no' },
    });
    const r = await call('GET', '/plan/replan/pending');
    expect(r.body).toEqual({ proposal: null, failed: { message: 'vet said no' } });
  });

  it('reports nothing going on as {proposal:null}', async () => {
    const r = await call('GET', '/plan/replan/pending');
    expect(r.body).toEqual({ proposal: null });
  });
});

describe('POST /plan/replan/preview/dismiss', () => {
  it('discards the preview AND the run record, so a dismissed failure stops answering the poll', async () => {
    const r = await call('POST', '/plan/replan/preview/dismiss');
    expect(r.status).toBe(200);
    expect(dismissReplan).toHaveBeenCalledWith('u1');
    expect(setPlanRun).toHaveBeenCalledWith('u1', null);
  });
});

describe('POST /plan/replan', () => {
  it('maps a veto (including the expired-preview refusal) to 422', async () => {
    confirmReplan.mockResolvedValue({
      status: 'vetoed',
      violations: ['That adjustment expired — run the preview again.'],
    });
    const r = await call('POST', '/plan/replan');
    expect(r.status).toBe(422);
    expect(r.body.violations).toEqual(['That adjustment expired — run the preview again.']);
  });
});

describe('POST /plan/proposal/accept', () => {
  it('keeps enter_disrupted synchronous — one quick job call, answered inline', async () => {
    getUser.mockResolvedValue({ pending_proposal: { action: 'enter_disrupted', episode_type: 'travel' } });
    enterEpisode.mockResolvedValue({ episode: { id: 'e1' } });
    const r = await call('POST', '/plan/proposal/accept');
    expect(r.status).toBe(200);
    expect(r.body.status).toBe('entered_disrupted');
    expect(claimPlanRun).not.toHaveBeenCalled();
  });

  it('runs a replan accept in the background (202) and pushes when the commit lands', async () => {
    getUser.mockResolvedValue({ pending_proposal: { action: 'replan' }, pending_plan: null, plan_run: null });
    replanPlan.mockResolvedValue({ status: 'committed', planId: 'p9', version: 9 });
    const r = await call('POST', '/plan/proposal/accept');
    expect(r.status).toBe(202);
    expect(r.body).toEqual({ running: true });
    await Promise.all(background);
    expect(replanPlan).toHaveBeenCalledWith('u1', undefined, expect.any(Function));
    expect(sendPlanReadyPush).toHaveBeenCalledWith(
      'u1',
      'replan_committed',
      'p9',
      'Your new week is set',
      'Come take a look — nothing else changes until you say so.',
    );
    // The successful run clears its record.
    expect(setPlanRun).toHaveBeenCalledWith('u1', null);
  });

  it('hands the rebaseline steer through', async () => {
    getUser.mockResolvedValue({ pending_proposal: { action: 'rebaseline' } });
    replanPlan.mockResolvedValue({ status: 'committed', planId: 'p9', version: 9 });
    await call('POST', '/plan/proposal/accept');
    await Promise.all(background);
    expect(replanPlan).toHaveBeenCalledWith('u1', 'rebaseline-steer', expect.any(Function));
  });
});
