import { describe, expect, it } from 'vitest';
import type { PendingPlanActivity } from '@cadence/shared';
import { groupWeek } from './weekGroups.ts';

const act = (over: Partial<PendingPlanActivity>): PendingPlanActivity => ({
  title: 'x',
  kind: 'user',
  cadence: 'Weekly',
  recurrence: 'FREQ=WEEKLY;BYDAY=MO',
  completion_source: 'self_report',
  ...over,
});

describe('groupWeek', () => {
  it('splits every-day, per-day and unplaceable rows, in week order', () => {
    const groups = groupWeek([
      act({ title: 'Log meals', recurrence: 'FREQ=DAILY' }),
      act({ title: 'Easy run', recurrence: 'FREQ=WEEKLY;BYDAY=WE', duration_min: 30 }),
      act({ title: 'Long run', recurrence: 'FREQ=WEEKLY;BYDAY=SA', duration_min: 70 }),
      act({ title: 'Stretch when you can', recurrence: 'FREQ=WEEKLY', cadence: 'Twice a week' }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(['Every day', 'Wednesday', 'Saturday', 'Whenever it fits']);
    expect(groups[0]!.kind).toBe('daily');
    expect(groups[3]!.kind).toBe('floating');
  });

  it('a multi-day activity appears under each of its days, and minutes sum per day', () => {
    const groups = groupWeek([
      act({ title: 'Morning joint mobility', recurrence: 'FREQ=WEEKLY;BYDAY=MO,WE', duration_min: 10 }),
      act({ title: 'Obstacle strength', recurrence: 'FREQ=WEEKLY;BYDAY=MO', duration_min: 45 }),
    ]);
    expect(groups.map((g) => g.label)).toEqual(['Monday', 'Wednesday']);
    expect(groups[0]!.minutes).toBe(55);
    expect(groups[1]!.minutes).toBe(10);
  });

  it('within a day, body comes before food, mind, and practice', () => {
    const groups = groupWeek([
      act({ title: 'Piano practice', recurrence: 'FREQ=WEEKLY;BYDAY=MO' }),
      act({ title: 'Box breathing practice', recurrence: 'FREQ=WEEKLY;BYDAY=MO' }),
      act({ title: 'Easy run', recurrence: 'FREQ=WEEKLY;BYDAY=MO' }),
    ]);
    expect(groups[0]!.rows.map((r) => r.title)).toEqual(['Easy run', 'Box breathing practice', 'Piano practice']);
  });
});
