/**
 * The plan-run machinery: readPlanRun's derivation (what the client poll is told) and
 * launchPlanRun's outcome handling (every ending settles the record — success clears, veto and
 * crash persist a message and push). All mocked at the repo/push seam; no DB, no network
 * (src/ai/aim.ts refuses network in tests by design, and nothing here should get near it).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const claimPlanRun = vi.fn();
const setPlanRun = vi.fn(async (..._a: unknown[]) => {});
const setPlanRunStage = vi.fn(async (..._a: unknown[]) => {});
const sendPlanReadyPush = vi.fn(async (..._a: unknown[]) => {});
// runInBackground normally detaches the settle promise; the tests capture it so they can await
// the run's ending before asserting on it.
const background: Promise<unknown>[] = [];

vi.mock('../repos/users.ts', () => ({
  PLAN_RUN_STALE_MINUTES: 15,
  claimPlanRun: (...a: unknown[]) => claimPlanRun(...a),
  setPlanRun: (...a: unknown[]) => setPlanRun(...a),
  setPlanRunStage: (...a: unknown[]) => setPlanRunStage(...a),
}));
vi.mock('./background.ts', () => ({
  runInBackground: (_label: string, work: Promise<unknown>) => void background.push(work),
}));
vi.mock('./plan-ready-push.ts', () => ({
  sendPlanReadyPush: (...a: unknown[]) => sendPlanReadyPush(...a),
}));

const { launchPlanRun, readPlanRun } = await import('./plan-run.ts');

const USER = '00000000-0000-4000-a000-00000000c201';
const NOW = new Date('2026-08-31T12:00:00.000Z');

beforeEach(() => {
  vi.clearAllMocks();
  background.length = 0;
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  claimPlanRun.mockResolvedValue(true);
});
afterEach(() => vi.useRealTimers());

const minutesAgo = (m: number): string => new Date(NOW.getTime() - m * 60_000).toISOString();

describe('readPlanRun', () => {
  it('reads nothing from a missing row or an empty record', () => {
    expect(readPlanRun(null)).toBeNull();
    expect(readPlanRun({})).toBeNull();
    expect(readPlanRun({ plan_run: null })).toBeNull();
  });

  it('reports a fresh running record, defaulting the stage to reading', () => {
    const startedAt = minutesAgo(1);
    expect(readPlanRun({ plan_run: { kind: 'replan_preview', status: 'running', started_at: startedAt } })).toEqual({
      status: 'running',
      stage: 'reading',
      startedAt,
    });
  });

  it('passes a reported stage through', () => {
    const startedAt = minutesAgo(3);
    expect(
      readPlanRun({
        plan_run: { kind: 'replan_preview', status: 'running', stage: 'drafting', started_at: startedAt },
      }),
    ).toEqual({ status: 'running', stage: 'drafting', startedAt });
  });

  it('reports a failed record with its stored message', () => {
    expect(
      readPlanRun({
        plan_run: { kind: 'proposal_accept', status: 'failed', started_at: minutesAgo(2), error: 'vet said no' },
      }),
    ).toEqual({ status: 'failed', error: 'vet said no' });
  });

  it('supplies a message when a failed record somehow has none', () => {
    expect(readPlanRun({ plan_run: { kind: 'replan_preview', status: 'failed', started_at: minutesAgo(2) } })).toEqual({
      status: 'failed',
      error: 'That run went quiet — try again.',
    });
  });

  it('reads a running record older than 15 minutes as failed — nothing can still be behind it', () => {
    expect(
      readPlanRun({ plan_run: { kind: 'replan_preview', status: 'running', started_at: minutesAgo(16) } }),
    ).toEqual({ status: 'failed', error: 'That run went quiet — try again.' });
    // Just inside the window still counts as running.
    expect(
      readPlanRun({ plan_run: { kind: 'replan_preview', status: 'running', started_at: minutesAgo(14) } })?.status,
    ).toBe('running');
  });

  it('reads an unparseable started_at as failed rather than running forever', () => {
    expect(
      readPlanRun({ plan_run: { kind: 'replan_preview', status: 'running', started_at: 'not-a-time' } })?.status,
    ).toBe('failed');
  });
});

describe('launchPlanRun', () => {
  it("joins when the claim loses — the work never starts and the loser's tap re-fires nothing", async () => {
    claimPlanRun.mockResolvedValue(false);
    const work = vi.fn();
    expect(await launchPlanRun(USER, 'replan_preview', work)).toBe('joined');
    expect(work).not.toHaveBeenCalled();
    expect(background).toHaveLength(0);
  });

  it('clears the record on a proposed result — the pending_plan is the success signal', async () => {
    const outcome = await launchPlanRun(USER, 'replan_preview', async () => ({ status: 'proposed' as const }));
    expect(outcome).toBe('started');
    expect(claimPlanRun).toHaveBeenCalledWith(USER, {
      kind: 'replan_preview',
      status: 'running',
      started_at: NOW.toISOString(),
    });
    await Promise.all(background);
    expect(setPlanRun).toHaveBeenCalledWith(USER, null);
    expect(sendPlanReadyPush).not.toHaveBeenCalled();
  });

  it('clears the record on a committed result', async () => {
    await launchPlanRun(USER, 'proposal_accept', async () => ({ status: 'committed' as const }));
    await Promise.all(background);
    expect(setPlanRun).toHaveBeenCalledWith(USER, null);
  });

  it('records a veto as failed with the violations joined, and pushes the failure', async () => {
    await launchPlanRun(USER, 'replan_preview', async () => ({
      status: 'vetoed' as const,
      violations: ['no goals', 'vet said no'],
    }));
    await Promise.all(background);
    expect(setPlanRun).toHaveBeenCalledWith(USER, {
      kind: 'replan_preview',
      status: 'failed',
      started_at: NOW.toISOString(),
      error: 'no goals; vet said no',
    });
    expect(sendPlanReadyPush).toHaveBeenCalledWith(
      USER,
      'replan_preview_failed',
      NOW.toISOString(),
      "That didn't finish",
      expect.stringContaining('nothing was lost'),
    );
  });

  it('records a thrown error as failed with plain words (never the stack), and pushes', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    await launchPlanRun(USER, 'proposal_accept', async () => {
      throw new Error('ECONNRESET deep in undici');
    });
    await Promise.all(background);
    consoleError.mockRestore();
    expect(setPlanRun).toHaveBeenCalledWith(USER, {
      kind: 'proposal_accept',
      status: 'failed',
      started_at: NOW.toISOString(),
      error: 'Something went wrong while I was reworking your week.',
    });
    expect(sendPlanReadyPush).toHaveBeenCalledWith(
      USER,
      'proposal_accept_failed',
      NOW.toISOString(),
      "That didn't finish",
      expect.any(String),
    );
  });
});
