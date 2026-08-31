import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The durability + observability contract from the 2026-08-31 silent death: every outcome is
 * logged, a veto or crash PUSHES (silence is the one forbidden result), and dispatch picks a
 * transport that can actually survive the work — self-request on Vercel, in-process elsewhere.
 */
const seams = vi.hoisted(() => ({
  previewReplan: vi.fn(),
  sendPlanReadyPush: vi.fn(async () => undefined),
  logAi: vi.fn(async () => undefined),
  runInBackground: vi.fn((_l: string, work: Promise<unknown>) => {
    void work.catch(() => {});
  }),
  cadenceConfig: { cronSecret: '' },
}));

vi.mock('./replan.ts', () => ({ previewReplan: seams.previewReplan }));
vi.mock('./plan-ready-push.ts', () => ({ sendPlanReadyPush: seams.sendPlanReadyPush }));
vi.mock('./ai-log.ts', () => ({ logAi: seams.logAi }));
vi.mock('./background.ts', () => ({ runInBackground: seams.runInBackground }));
vi.mock('../config.ts', () => ({ cadenceConfig: seams.cadenceConfig }));

import { runSteeredRebalance, dispatchRebalance } from './rebalance-run.ts';

const fetchSpy = vi.fn(async () => new Response('{}'));

beforeEach(() => {
  vi.clearAllMocks();
  seams.cadenceConfig.cronSecret = '';
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('runSteeredRebalance', () => {
  it('a proposed week logs its outcome and sends no failure push (the ready push is previewReplan’s)', async () => {
    seams.previewReplan.mockResolvedValue({ status: 'proposed', proposal: { activities: [] } });
    const r = await runSteeredRebalance('u1', 'more cardio');
    expect(r.status).toBe('proposed');
    expect(seams.logAi).toHaveBeenCalledWith('u1', expect.objectContaining({ kind: 'rebalance_week' }));
    expect(seams.sendPlanReadyPush).not.toHaveBeenCalled();
  });

  it('a veto pushes — the user was told they could walk away', async () => {
    seams.previewReplan.mockResolvedValue({ status: 'vetoed', violations: ['No active goals to re-plan.'] });
    const r = await runSteeredRebalance('u1', 'more cardio');
    expect(r.status).toBe('vetoed');
    expect(seams.sendPlanReadyPush).toHaveBeenCalledWith(
      'u1',
      'rebalance_failed',
      expect.any(String),
      expect.any(String),
      expect.any(String),
    );
  });

  it('a crash logs, pushes, and returns a veto instead of throwing', async () => {
    seams.previewReplan.mockRejectedValue(new Error('synthesis died'));
    const r = await runSteeredRebalance('u1', 'more cardio');
    expect(r.status).toBe('vetoed');
    expect(seams.sendPlanReadyPush).toHaveBeenCalled();
    expect(seams.logAi).toHaveBeenCalledWith(
      'u1',
      expect.objectContaining({ output: expect.objectContaining({ status: 'error' }) }),
    );
  });
});

describe('dispatchRebalance', () => {
  it('self-requests when the deployment can address itself and the internal gate has a secret', () => {
    vi.stubEnv('VERCEL_URL', 'cadence-api.vercel.app');
    seams.cadenceConfig.cronSecret = 's3cret';
    dispatchRebalance('u1', 'more cardio');
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://cadence-api.vercel.app/internal/plan/rebalance',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(seams.previewReplan).not.toHaveBeenCalled();
  });

  it('runs in-process when there is no self-address — local dev, where nothing freezes', () => {
    seams.previewReplan.mockResolvedValue({ status: 'proposed', proposal: { activities: [] } });
    dispatchRebalance('u1', 'more cardio');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(seams.runInBackground).toHaveBeenCalledWith('rebalance_week', expect.any(Promise));
  });
});
