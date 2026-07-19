import { describe, it, expect } from 'vitest';
import { isGoalArea, GOAL_AREAS, type GoalArea } from './index.ts';

/**
 * `@cadence/shared` is a types-only package by design — the one runtime export
 * (`isGoalArea`) exists specifically to guard raw Scribe/model output before the
 * app trusts it as a `GoalArea` (see the file's §5.1 header comment). This is the
 * seam most likely to receive an unexpected string from an LLM, so it's the
 * highest-leverage smoke test available in this package today.
 */
describe('isGoalArea', () => {
  it('accepts every canonical GoalArea value', () => {
    const areas: GoalArea[] = ['movement', 'nourishment', 'mind', 'practice'];
    for (const area of areas) {
      expect(isGoalArea(area)).toBe(true);
    }
    expect(GOAL_AREAS).toEqual(areas);
  });

  it('rejects the deleted legacy "weight" area and other untrusted strings', () => {
    expect(isGoalArea('weight')).toBe(false);
    expect(isGoalArea('fitness')).toBe(false);
    expect(isGoalArea('')).toBe(false);
  });

  it('rejects non-string values a model could still emit as JSON', () => {
    expect(isGoalArea(null)).toBe(false);
    expect(isGoalArea(undefined)).toBe(false);
    expect(isGoalArea(42)).toBe(false);
    expect(isGoalArea(['movement'])).toBe(false);
  });
});
