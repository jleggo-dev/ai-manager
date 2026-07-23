import { describe, it, expect } from 'vitest';
import type { Goal, PendingPlanActivity } from '@cadence/shared';
import { splitCoverage } from './plan-coverage.ts';

const goal = (goal_id: string, title: string): Goal => ({ goal_id, title }) as Goal;
const act = (goal_id?: string, goal_title?: string): Pick<PendingPlanActivity, 'goal_id' | 'goal_title'> => ({
  goal_id,
  goal_title,
});

describe('splitCoverage', () => {
  const goals = [goal('a', 'Run a 10k'), goal('b', 'Lose weight'), goal('c', 'Stop drinking')];

  it('covers a goal by resolved goal_id', () => {
    const { covered, missing } = splitCoverage([act('a', 'Run a 10k')], goals);
    expect(covered.map((g) => g.goal_id)).toEqual(['a']);
    expect(missing.map((g) => g.goal_id)).toEqual(['b', 'c']);
  });

  it('covers a goal by fuzzy goal_title when the id is absent (a rephrase)', () => {
    // No goal_id, and the title is a superset of the goal's — matchGoal-style fuzzy match.
    const { covered } = splitCoverage([act(undefined, 'Run a 10k this spring')], goals);
    expect(covered.map((g) => g.goal_id)).toContain('a');
  });

  it('reports every goal missing when the plan is empty', () => {
    const { covered, missing } = splitCoverage([], goals);
    expect(covered).toEqual([]);
    expect(missing).toHaveLength(3);
  });

  it('does not credit an activity with a blank goal link', () => {
    const { missing } = splitCoverage([act(undefined, ''), act(undefined, undefined)], goals);
    expect(missing).toHaveLength(3);
  });

  it('covers multiple goals across a mixed plan', () => {
    const { covered, missing } = splitCoverage([act('a', 'Run a 10k'), act(undefined, 'Stop drinking')], goals);
    expect(covered.map((g) => g.goal_id).sort()).toEqual(['a', 'c']);
    expect(missing.map((g) => g.goal_id)).toEqual(['b']);
  });
});
