import type { PendingPlanActivity } from '@cadence/shared';
import { groupByGoal } from './groupByGoal.ts';

function act(partial: Partial<PendingPlanActivity> & Pick<PendingPlanActivity, 'title'>): PendingPlanActivity {
  return {
    kind: 'user',
    cadence: 'Daily',
    recurrence: 'FREQ=DAILY',
    completion_source: 'self_report',
    ...partial,
  };
}

describe('groupByGoal', () => {
  it('groups by goal_id in first-seen order and sinks Foundations', () => {
    const groups = groupByGoal([
      act({ title: 'Walk', goal_id: 'g1', goal_title: 'Move more' }),
      act({ title: 'Weekly check-in' }), // no goal → Foundations
      act({ title: 'Lift', goal_id: 'g1', goal_title: 'Move more' }),
      act({ title: 'Journal', goal_id: 'g2', goal_title: 'Mind' }),
    ]);

    expect(groups.map((g) => g.key)).toEqual(['g1', 'g2', '__foundations__']);
    expect(groups[0]).toMatchObject({
      title: 'Move more',
      items: [{ title: 'Walk' }, { title: 'Lift' }],
    });
    expect(groups[2]!.title).toBe('Foundations');
    expect(groups[2]!.items).toHaveLength(1);
  });

  it('uses Foundations title when goal_title is missing on an unlinked item', () => {
    const groups = groupByGoal([act({ title: 'System row' })]);
    expect(groups).toEqual([
      {
        key: '__foundations__',
        title: 'Foundations',
        items: [expect.objectContaining({ title: 'System row' })],
      },
    ]);
  });
});
