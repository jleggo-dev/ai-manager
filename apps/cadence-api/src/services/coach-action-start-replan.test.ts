/**
 * `start_replan` — thin over the shared spine (replan-start.ts), so what's tested here is the
 * translation contract: the person's words reach the launch untouched, 'started' hands the coach
 * only facts the launched run itself will deliver (card, push, background, minutes — never a
 * claim of a changed plan), and 'joined' says plainly that no second rebuild fired and this
 * call's words went unused.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./replan-start.ts', () => ({ startReplanRun: vi.fn() }));
vi.mock('../repos/users.ts', () => ({
  getUser: vi.fn(),
  claimPlanRun: vi.fn(),
  setPlanRun: vi.fn(),
  setPlanRunStage: vi.fn(),
  PLAN_RUN_STALE_MINUTES: 15,
}));
// readPlanRun (plan-run.ts) runs REAL — the joined path's "started N min ago" is its derivation —
// so the push it drags along is severed at the seam, same as the registry render tests.
vi.mock('./plan-ready-push.ts', () => ({ sendPlanReadyPush: vi.fn() }));

import { startReplanRun } from './replan-start.ts';
import { getUser } from '../repos/users.ts';
import { START_REPLAN } from './coach-action-start-replan.ts';

beforeEach(() => {
  vi.mocked(startReplanRun).mockReset().mockResolvedValue('started');
  vi.mocked(getUser)
    .mockReset()
    .mockResolvedValue({ plan_run: null } as never);
});

describe('start_replan', () => {
  it('refuses an empty steer without launching anything — the rebuild is shaped by their words or not at all', async () => {
    expect(await START_REPLAN.run('u1', {})).toContain('nothing was started');
    expect(await START_REPLAN.run('u1', { steer: '   ' })).toContain('nothing was started');
    expect(startReplanRun).not.toHaveBeenCalled();
  });

  it('hands the steer through untouched and returns the facts she can speak to', async () => {
    const out = await START_REPLAN.run('u1', { steer: 'more recovery, keep the long run' });
    expect(startReplanRun).toHaveBeenCalledWith('u1', 'more recovery, keep the long run');
    expect(out).toContain('being rebuilt around "more recovery, keep the long run"');
    expect(out).toContain('in the background');
    expect(out).toContain('takes a few minutes');
    expect(out).toContain('card with the reworked week will appear on their plan');
    expect(out).toContain('notification will reach them');
    expect(out).toContain('they do not have to wait in this chat');
    // The completeness rule's sharp edge: nothing has changed and nothing may claim to have.
    expect(out).toContain('nothing does until they apply the card');
  });

  it('says a rebuild is ALREADY going on a join — with its age from the same record the client polls', async () => {
    vi.mocked(startReplanRun).mockResolvedValue('joined');
    vi.mocked(getUser).mockResolvedValue({
      plan_run: {
        kind: 'replan_preview',
        status: 'running',
        stage: 'drafting',
        started_at: new Date(Date.now() - 5 * 60_000).toISOString(),
      },
    } as never);
    const out = await START_REPLAN.run('u1', { steer: 'redo the week' });
    expect(out).toContain('ALREADY being drawn up (started 5 min ago)');
    expect(out).toContain('no second one was started');
    expect(out).toContain('NOT used');
  });

  it('still reports the join honestly when the record cannot be read — less said beats a guess', async () => {
    vi.mocked(startReplanRun).mockResolvedValue('joined');
    vi.mocked(getUser).mockRejectedValue(new Error('db down'));
    const out = await START_REPLAN.run('u1', { steer: 'redo the week' });
    expect(out).toContain('ALREADY being drawn up —');
    expect(out).not.toContain('min ago');
  });
});
