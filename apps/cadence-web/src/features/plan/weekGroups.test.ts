import { describe, expect, it } from 'vitest';
import type { PendingPlanActivity } from '@cadence/shared';
import { groupWeek, rowMeta, type WeekRowLike } from './weekGroups.ts';

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
    expect(groups[0]!.rows.map((r) => r.a.title)).toEqual(['Easy run', 'Box breathing practice', 'Piano practice']);
  });

  it('marks only the FIRST appearance of a commitment — the why lands once, not four times', () => {
    const groups = groupWeek([
      act({ title: 'Morning joint mobility', recurrence: 'FREQ=WEEKLY;BYDAY=MO,WE,FR', commitment_id: 'c1' }),
      act({ title: 'Easy run', recurrence: 'FREQ=WEEKLY;BYDAY=WE', commitment_id: 'c2' }),
    ]);
    const flat = groups.flatMap((g) => g.rows.map((r) => ({ title: r.a.title, day: g.label, first: r.first })));
    expect(flat).toEqual([
      { title: 'Morning joint mobility', day: 'Monday', first: true },
      { title: 'Morning joint mobility', day: 'Wednesday', first: false },
      { title: 'Easy run', day: 'Wednesday', first: true },
      { title: 'Morning joint mobility', day: 'Friday', first: false },
    ]);
  });
});

describe('rowMeta', () => {
  const row = (over: Partial<WeekRowLike>): WeekRowLike => ({
    title: 'x',
    cadence: 'Mon, Wed, Fri',
    recurrence: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
    ...over,
  });

  it('scheduled rows say time · minutes; floating rows lead with the cadence', () => {
    expect(rowMeta(row({ time_of_day: 'morning', duration_min: 45 }), 'day')).toBe('morning · 45 min');
    expect(rowMeta(row({ cadence: 'Twice a week', duration_min: 45 }), 'floating')).toBe('Twice a week · 45 min');
  });

  /**
   * The consent row carries both numbers (owner ruling 2026-08-17): the effort they named, and
   * what to keep free for it. Deciding whether you can afford a rhythm needs the second one.
   */
  it('shows the effort AND the time to set aside, when there is warm-up to allow for', () => {
    expect(rowMeta(row({ duration_min: 45, area: 'movement' }), 'day')).toBe('45 min (allow 55)');
  });

  it('keeps a meditation at its full length and budgets the settling time separately', () => {
    expect(rowMeta(row({ duration_min: 20, area: 'mind' }), 'day')).toBe('20 min (allow 25)');
  });

  it('stays a single number when the effort is the whole session', () => {
    expect(rowMeta(row({ duration_min: 15, area: 'nourishment' }), 'day')).toBe('15 min');
  });
});
