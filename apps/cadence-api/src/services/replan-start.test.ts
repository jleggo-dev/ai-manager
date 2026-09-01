/**
 * The shared spine (Phase 2, docs/cadence/PLAN-CHANGES.md): POST /plan/replan/preview and the
 * coach's start_replan tool launch the SAME run the same way. What's held here is the wiring the
 * extraction promised to keep byte-identical — the run kind, the steer handed through untouched,
 * and the stage callback stamping the durable record. The route's own contract (202s, joins,
 * polls) stays in routes/plan-replan.test.ts, where plan-run.ts runs real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./replan.ts', () => ({ previewReplan: vi.fn() }));
vi.mock('./plan-run.ts', () => ({ launchPlanRun: vi.fn(), planRunStage: vi.fn() }));

import { previewReplan } from './replan.ts';
import { launchPlanRun, planRunStage } from './plan-run.ts';
import { startReplanRun } from './replan-start.ts';

beforeEach(() => {
  vi.mocked(launchPlanRun).mockReset().mockResolvedValue('started');
  vi.mocked(previewReplan)
    .mockReset()
    .mockResolvedValue({ status: 'proposed' } as never);
  vi.mocked(planRunStage).mockReset();
});

describe('startReplanRun', () => {
  it("launches the preview as the user's one 'replan_preview' run and reports the claim outcome", async () => {
    expect(await startReplanRun('u1', 'more recovery')).toBe('started');
    expect(launchPlanRun).toHaveBeenCalledWith('u1', 'replan_preview', expect.any(Function));

    // The work closure is what the run machinery executes: the steer arrives untouched, and the
    // stage callback stamps the record for THIS user — the poll's narration depends on both.
    const work = vi.mocked(launchPlanRun).mock.calls[0]![2] as () => Promise<unknown>;
    await work();
    expect(previewReplan).toHaveBeenCalledWith('u1', 'more recovery', expect.any(Function));
    const onStage = vi.mocked(previewReplan).mock.calls[0]![2] as (s: string) => void;
    onStage('drafting');
    expect(planRunStage).toHaveBeenCalledWith('u1', 'drafting');
  });

  it("passes 'joined' through and never runs the work itself — joining is the machinery's job", async () => {
    vi.mocked(launchPlanRun).mockResolvedValue('joined');
    expect(await startReplanRun('u1', undefined)).toBe('joined');
    expect(previewReplan).not.toHaveBeenCalled();
  });
});
