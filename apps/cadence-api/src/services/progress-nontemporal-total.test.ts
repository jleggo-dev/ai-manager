import { describe, it, expect } from 'vitest';
import type { Goal } from '@cadence/shared';
import type { PracticeTotal } from './practice-totals.ts';
import { resolveTotal } from './progress-nontemporal-total.ts';

function goal(patch: Partial<Goal> = {}): Goal {
  return {
    goal_id: 'zzq-goal',
    title: 'Write daily',
    area: 'practice',
    type: 'recurring',
    measure: { metric: 'words', target: 0, unit: 'words' },
    timeframe: {},
    status: 'confirmed',
    linked_equipment: [],
    source: 'manual',
    ...patch,
  };
}

function total(patch: Partial<PracticeTotal> = {}): PracticeTotal {
  return { title: 'Journaling', metric: 'words', total: 3200, sessions: 9, ...patch };
}

describe('resolveTotal', () => {
  it('omits with evidence when nothing matches the goal', () => {
    expect(resolveTotal(goal(), [], 'this month')).toEqual({
      id: 'total:zzq-goal',
      kind: 'total',
      reason: 'no logged practice totals matching this goal',
    });
  });

  it('matches by the goal measure unit against the totals metric key (words -> words)', () => {
    const totals = [total({ metric: 'words', total: 3200 }), total({ title: 'Sitting', metric: 'minutes', total: 40 })];
    expect(resolveTotal(goal({ measure: { metric: 'words', target: 0, unit: 'words' } }), totals, 'this month')).toEqual({
      value: 3200,
      unit: 'words',
      window_label: 'this month',
    });
  });

  it('falls back to matching the activity title when no unit matches', () => {
    const totals = [total({ title: 'Write daily', metric: 'sessions_logged', total: 5 })];
    expect(resolveTotal(goal({ measure: { metric: 'sessions', target: 0, unit: '' } }), totals, 'this week')).toEqual({
      value: 5,
      unit: 'sessions logged',
      window_label: 'this week',
    });
  });
});
