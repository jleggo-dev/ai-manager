/**
 * Settings Room SR-1's load-bearing question for the first-lock path: does a retired ('parked')
 * goal ever reach synthesize_plan? previewLock only mocks repos/goals.ts — with it returning []
 * for both status queries, previewLock's own "no confirmed goals" guard short-circuits BEFORE it
 * touches getUser/listEquipment/planSynthesize/etc, so those real modules never execute a query;
 * they only need to import cleanly, which they already do (their DB clients are lazy). That keeps
 * this test honest — it exercises the ACTUAL status list previewLock passes, not a copy of it —
 * without the weight of mocking lock.ts's whole dependency graph for a fact two lines decide.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const listGoalsByStatus = vi.fn();
const setGoalStatus = vi.fn();

vi.mock('../repos/goals.ts', () => ({
  listGoalsByStatus: (...a: unknown[]) => listGoalsByStatus(...a),
  setGoalStatus: (...a: unknown[]) => setGoalStatus(...a),
}));

const { previewLock } = await import('./lock.ts');

beforeEach(() => {
  vi.clearAllMocks();
  listGoalsByStatus.mockResolvedValue([]);
});

describe('previewLock — parked-goal exclusion', () => {
  it('never asks the repo for parked goals, at either status read', async () => {
    const res = await previewLock('u1');
    expect(res.status).toBe('vetoed');
    expect(listGoalsByStatus).toHaveBeenCalled();
    for (const [, statuses] of listGoalsByStatus.mock.calls) {
      expect(statuses).not.toContain('parked');
    }
  });

  it("the goal-selection read for synthesis is exactly ['confirmed'] — a retired goal is confirmed→committed, never confirmed again, so it cannot re-enter this way either", async () => {
    await previewLock('u1');
    const [, secondCallStatuses] = listGoalsByStatus.mock.calls[1]!;
    expect(secondCallStatuses).toEqual(['confirmed']);
  });
});
