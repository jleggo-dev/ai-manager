import { describe, it, expect } from 'vitest';
import type { Goal, GoalMilestone } from '@cadence/shared';
import { resolveStagePath, resolveCountToward } from './progress-nontemporal-goal.ts';

function goal(patch: Partial<Goal> = {}): Goal {
  return {
    goal_id: 'zzq-goal',
    title: 'Write a novel',
    area: 'practice',
    type: 'milestone',
    measure: { metric: 'books', target: 1, unit: 'book' },
    timeframe: {},
    status: 'confirmed',
    linked_equipment: [],
    source: 'manual',
    ...patch,
  };
}

function milestone(id: string, label: string, patch: Partial<GoalMilestone> = {}): GoalMilestone {
  return { id, label, ...patch };
}

describe('resolveStagePath', () => {
  it('omits with evidence when the goal has no milestones', () => {
    expect(resolveStagePath(goal({ milestones: [] }))).toEqual({
      id: 'stage_path:zzq-goal',
      kind: 'stage_path',
      reason: 'goal has no milestones',
    });
  });

  it('the first not-done milestone is current; done stays done; the rest are ahead', () => {
    const milestones = [
      milestone('m1', 'outline', { done: true, target_date: '2026-06-01' }),
      milestone('m2', 'part one', { done: true, target_date: '2026-07-01' }),
      milestone('m3', 'part two', { done: false, target_date: '2026-08-01' }),
      milestone('m4', 'revision', { done: false, target_date: '2026-09-01' }),
    ];
    expect(resolveStagePath(goal({ milestones }))).toEqual({
      stages: [
        { label: 'outline', state: 'done' },
        { label: 'part one', state: 'done' },
        { label: 'part two', state: 'current' },
        { label: 'revision', state: 'ahead' },
      ],
      note: null,
    });
  });

  it('orders by target_date even when given out of order; undated milestones sort first', () => {
    const milestones = [
      milestone('m2', 'later', { target_date: '2026-09-01' }),
      milestone('m1', 'earlier', { target_date: '2026-08-01' }),
    ];
    const result = resolveStagePath(goal({ milestones }));
    expect('stages' in result && result.stages.map((s) => s.label)).toEqual(['earlier', 'later']);
  });

  it('all done — nothing is current, nothing throws', () => {
    const milestones = [milestone('m1', 'outline', { done: true }), milestone('m2', 'draft', { done: true })];
    const result = resolveStagePath(goal({ milestones }));
    expect('stages' in result && result.stages.every((s) => s.state === 'done')).toBe(true);
  });
});

describe('resolveCountToward', () => {
  it('omits with evidence when the goal has no numeric target', () => {
    expect(resolveCountToward(goal({ measure: { metric: 'books', target: 'a lot' } }), 3)).toEqual({
      id: 'count_toward:zzq-goal',
      kind: 'count_toward',
      reason: 'goal has no numeric target',
    });
  });

  it("mirrors services/progress.ts's count card: current from the caller, target/unit from measure", () => {
    expect(resolveCountToward(goal({ measure: { metric: 'books', target: 100, unit: 'books' } }), 21)).toEqual({
      current: 21,
      target: 100,
      unit: 'books',
    });
  });

  it('falls back to "done" when the goal measure has no unit — same fallback the count card uses', () => {
    expect(resolveCountToward(goal({ measure: { metric: 'races', target: 5, unit: '' } }), 2)).toEqual({
      current: 2,
      target: 5,
      unit: 'done',
    });
  });
});
