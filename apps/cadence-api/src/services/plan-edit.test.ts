import { describe, expect, it } from 'vitest';
import type { Activity } from '@cadence/shared';
import { applyPlanEdits, matchActivity } from './plan-edit.ts';

/**
 * The edit engine decides what a person's week becomes, with no model in the loop and no human
 * reading the result before it is offered. So the cases that matter here are the ones where being
 * wrong is quiet: an edit that hits the wrong session, an edit that silently does nothing, or a
 * change that drags the rest of the plan along with it.
 */

const act = (over: Partial<Activity> & { title: string }): Activity => ({
  activity_id: `a-${over.title}`,
  plan_id: 'p1',
  kind: 'user',
  schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=TH', duration_min: 40 },
  completion_source: 'self_report',
  ...over,
});

const PLAN: Activity[] = [
  act({ title: 'Easy run', goal_id: 'g1' }),
  act({ title: 'Long run', schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=SU', duration_min: 90 }, goal_id: 'g1' }),
  act({ title: 'Sit', schedule: { recurrence: 'FREQ=DAILY', duration_min: 10 }, goal_id: 'g2' }),
];
const GOALS = { g1: 'Run a 10k', g2: 'A steadier mind' };

describe('applyPlanEdits', () => {
  it('moves one session and leaves every other one exactly as it was', () => {
    const r = applyPlanEdits(PLAN, [{ action: 'move', activity: 'Easy run', days: ['friday'] }], GOALS);
    expect(r.rejected).toEqual([]);
    // Day names match the rest of the plan UI (describeRecurrence's vocabulary), not prose.
    expect(r.changes).toEqual(['Move Easy run: Thu → Fri']);
    const run = r.activities.find((a) => a.title === 'Easy run')!;
    expect(run.recurrence).toBe('FREQ=WEEKLY;BYDAY=FR');
    // The blast radius is the whole point: nothing else may drift.
    expect(r.activities.find((a) => a.title === 'Long run')!.recurrence).toBe('FREQ=WEEKLY;BYDAY=SU');
    expect(r.activities.find((a) => a.title === 'Sit')!.duration_min).toBe(10);
    expect(r.activities).toHaveLength(3);
  });

  it('applies several edits to the same session in the order given', () => {
    const r = applyPlanEdits(
      PLAN,
      [
        { action: 'move', activity: 'Easy run', days: ['mon', 'wed'] },
        { action: 'resize', activity: 'Easy run', duration_min: 20 },
      ],
      GOALS,
    );
    const run = r.activities.find((a) => a.title === 'Easy run')!;
    expect(run.recurrence).toBe('FREQ=WEEKLY;BYDAY=MO,WE');
    expect(run.duration_min).toBe(20);
    expect(r.changes).toHaveLength(2);
  });

  it('keeps the interval when it moves a fortnightly session', () => {
    const fortnightly = [act({ title: 'Long ride', schedule: { recurrence: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=SA' } })];
    const r = applyPlanEdits(fortnightly, [{ action: 'move', activity: 'Long ride', days: ['sunday'] }]);
    expect(r.activities[0]!.recurrence).toBe('FREQ=WEEKLY;INTERVAL=2;BYDAY=SU');
  });

  it('refuses an ambiguous name rather than changing the wrong session', () => {
    // "run" matches both Easy run and Long run — a coin flip here edits someone's real week.
    const r = applyPlanEdits(PLAN, [{ action: 'remove', activity: 'run' }], GOALS);
    expect(r.changes).toEqual([]);
    expect(r.rejected[0]).toMatch(/Nothing in the plan clearly matches "run"/);
    expect(r.activities).toHaveLength(3);
  });

  it('applies the edits it understands and reports the ones it does not', () => {
    const r = applyPlanEdits(
      PLAN,
      [
        { action: 'remove', activity: 'Long run' },
        { action: 'move', activity: 'Yoga', days: ['tuesday'] },
      ],
      GOALS,
    );
    expect(r.changes).toEqual(['Drop Long run']);
    expect(r.rejected).toHaveLength(1);
    expect(r.activities.map((a) => a.title)).toEqual(['Easy run', 'Sit']);
  });

  it('adds a commitment, attributed to the goal it serves', () => {
    const r = applyPlanEdits(
      PLAN,
      [{ action: 'add', title: 'Easy walk', days: ['saturday'], duration_min: 30, goal_title: 'A steadier mind' }],
      GOALS,
    );
    const walk = r.activities.find((a) => a.title === 'Easy walk')!;
    expect(walk.recurrence).toBe('FREQ=WEEKLY;BYDAY=SA');
    expect(walk.goal_id).toBe('g2');
    expect(walk.suggested).toBe(true);
    expect(r.changes[0]).toBe('Add Easy walk — Sat');
  });

  it('rejects an edit whose numbers make no sense instead of writing them', () => {
    const r = applyPlanEdits(PLAN, [{ action: 'resize', activity: 'Sit', duration_min: 0 }], GOALS);
    expect(r.changes).toEqual([]);
    expect(r.rejected[0]).toMatch(/how long/);
    expect(r.activities.find((a) => a.title === 'Sit')!.duration_min).toBe(10);
  });

  it('carries the coach rationale and goal grouping through untouched activities', () => {
    const withWhy = [act({ title: 'Sit', why: 'Ten minutes is a rhythm you can keep on a bad day.', goal_id: 'g2' })];
    const r = applyPlanEdits(withWhy, [{ action: 'retime', activity: 'Sit', time_of_day: '07:00' }], GOALS);
    expect(r.activities[0]!.why).toBe('Ten minutes is a rhythm you can keep on a bad day.');
    expect(r.activities[0]!.goal_title).toBe('A steadier mind');
    expect(r.activities[0]!.time_of_day).toBe('07:00');
  });
});

describe('matchActivity', () => {
  it('prefers an exact title over a containing one', () => {
    const items = [{ title: 'Run' }, { title: 'Run club' }];
    expect(matchActivity(items, 'Run')?.title).toBe('Run');
  });

  it('matches a partial name when only one thing could be meant', () => {
    expect(matchActivity(PLAN, 'sit')?.title).toBe('Sit');
    expect(matchActivity(PLAN, 'Easy')?.title).toBe('Easy run');
  });

  it('returns nothing for an empty or unmatched query', () => {
    expect(matchActivity(PLAN, '  ')).toBeNull();
    expect(matchActivity(PLAN, 'swimming')).toBeNull();
  });
});
