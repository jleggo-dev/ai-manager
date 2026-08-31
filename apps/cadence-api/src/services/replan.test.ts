/**
 * Settings Room SR-1's load-bearing question for the re-plan path: does a retired ('parked') goal
 * ever reach synthesize_plan on an "Adjust my plan" or the weekly adaptive re-plan? Same minimal-
 * mock approach as lock.test.ts — gatherReplanInputs's own "no goals" guard returns null right
 * after the one repo call this test cares about, before replanPlan/previewReplan touch anything
 * else, so only repos/goals.ts needs mocking to exercise the real status list they pass.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const listGoalsByStatus = vi.fn();

vi.mock('../repos/goals.ts', () => ({
  listGoalsByStatus: (...a: unknown[]) => listGoalsByStatus(...a),
}));

const { replanPlan, previewReplan } = await import('./replan.ts');

beforeEach(() => {
  vi.clearAllMocks();
  listGoalsByStatus.mockResolvedValue([]);
});

describe('re-plan — parked-goal exclusion', () => {
  it('replanPlan (adaptive, auto-commit) never asks for parked goals', async () => {
    const res = await replanPlan('u1');
    expect(res.status).toBe('vetoed');
    const [, statuses] = listGoalsByStatus.mock.calls[0]!;
    expect(statuses).not.toContain('parked');
    expect(statuses).toEqual(['committed', 'confirmed']);
  });

  it('previewReplan (manual "Adjust my plan") never asks for parked goals', async () => {
    const res = await previewReplan('u1');
    expect(res.status).toBe('vetoed');
    const [, statuses] = listGoalsByStatus.mock.calls[0]!;
    expect(statuses).not.toContain('parked');
    expect(statuses).toEqual(['committed', 'confirmed']);
  });
});
