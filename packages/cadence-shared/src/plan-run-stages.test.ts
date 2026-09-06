import { describe, it, expect } from 'vitest';
import {
  PLAN_RUN_STAGES,
  PLAN_RUN_STAGE_FLOOR,
  planRunProgress,
  planRunProgressFloor,
  type PlanRunStage,
} from './plan-run-stages.ts';

/**
 * A progress bar is a deterministic router in disguise: it decides a number nobody asserts, and
 * when it is wrong nothing throws — the user simply watches a bar sit at 97% for two minutes, or
 * hit 100% over a plan that does not exist yet. So it gets a table, including the near-misses.
 */
describe('planRunProgress', () => {
  it('never reaches 1, however long a stage runs', () => {
    for (const stage of PLAN_RUN_STAGES) {
      expect(planRunProgress(stage, undefined, 60 * 60_000)).toBeLessThan(1);
    }
  });

  it('never goes backwards as the stages advance', () => {
    const seen = PLAN_RUN_STAGES.map((s) => planRunProgress(s, undefined, 0));
    seen.forEach((value, i) => {
      if (i > 0) expect(value).toBeGreaterThan(seen[i - 1] ?? -1);
    });
  });

  it('reports nothing for a run that has not said what it is doing', () => {
    expect(planRunProgress(undefined, undefined, 10_000)).toBe(0);
    expect(planRunProgressFloor(undefined)).toBe(0);
  });

  it('keeps moving while a stage sits still, so the screen is never frozen', () => {
    const a = planRunProgress('coordinating', undefined, 10_000);
    const b = planRunProgress('coordinating', undefined, 70_000);
    const c = planRunProgress('coordinating', undefined, 200_000);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  /** The whole reason `drafted` exists: real events must outrank the timer. */
  it('advances on a landed draft further than time alone would have taken it', () => {
    const onTime = planRunProgress('drafting', { done: 0, total: 3 }, 30_000);
    const onFact = planRunProgress('drafting', { done: 2, total: 3 }, 30_000);
    expect(onFact).toBeGreaterThan(onTime);
  });

  it('does not let the easing overtake the next real checkpoint', () => {
    // One goal of three landed, then a very long wait: must not imply the second has landed.
    const stalled = planRunProgress('drafting', { done: 1, total: 3 }, 10 * 60_000);
    const twoLanded = planRunProgress('drafting', { done: 2, total: 3 }, 0);
    expect(stalled).toBeLessThanOrEqual(twoLanded);
  });

  it('stays inside its own stage band rather than borrowing the next one', () => {
    const next: Record<PlanRunStage, number> = {
      reading: PLAN_RUN_STAGE_FLOOR.drafting,
      drafting: PLAN_RUN_STAGE_FLOOR.coordinating,
      coordinating: PLAN_RUN_STAGE_FLOOR.repairing,
      repairing: PLAN_RUN_STAGE_FLOOR.saving,
      saving: 1,
    };
    for (const stage of PLAN_RUN_STAGES) {
      const long = planRunProgress(stage, undefined, 30 * 60_000);
      expect(long).toBeGreaterThanOrEqual(PLAN_RUN_STAGE_FLOOR[stage]);
      expect(long).toBeLessThan(next[stage]);
    }
  });

  /**
   * `repairing` is skipped on a dense week, so the bar jumps coordinating → saving. That jump is
   * correct and must not be "smoothed" later by treating the skipped stage as time still owed.
   */
  it('lets a skipped repair jump straight to saving', () => {
    expect(planRunProgressFloor('saving')).toBeGreaterThan(planRunProgressFloor('repairing'));
    expect(planRunProgress('saving', undefined, 0)).toBeGreaterThan(planRunProgress('coordinating', undefined, 0));
  });
});
