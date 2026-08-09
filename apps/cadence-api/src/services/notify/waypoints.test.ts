/**
 * Waypoints are pure date arithmetic, and date arithmetic is where a countdown quietly announces
 * the wrong week. These pin the spacing, the ordering, and the two things that must NOT produce a
 * waypoint: a date already passed, and a milestone already reached.
 */
import { describe, it, expect } from 'vitest';
import type { Goal } from '@cadence/shared';
import { waypointsForGoals } from './waypoints.ts';

const goal = (over: Partial<Goal> = {}): Goal =>
  ({
    goal_id: 'g1',
    title: 'Run a 10k',
    area: 'movement',
    type: 'milestone',
    measure: { metric: 'distance', target: 10 },
    timeframe: { start: '2026-07-01', end: '2026-09-19' },
    milestones: [],
    status: 'committed',
    linked_equipment: [],
    source: 'manual',
    ...over,
  }) as Goal;

describe('waypointsForGoals', () => {
  it('places four waypoints: six weeks, three weeks, one week, and the day before', () => {
    const out = waypointsForGoals([goal()], '2026-07-01');
    expect(out.map((w) => [w.date, w.weeksOut])).toEqual([
      ['2026-08-08', 6],
      ['2026-08-29', 3],
      ['2026-09-12', 1],
      ['2026-09-18', 0],
    ]);
  });

  it('never announces a waypoint late', () => {
    const out = waypointsForGoals([goal()], '2026-09-01');
    expect(out.map((w) => w.weeksOut)).toEqual([1, 0]);
  });

  it('counts toward milestones as well as the goal’s own end date', () => {
    const out = waypointsForGoals(
      [goal({ milestones: [{ id: 'm1', label: 'first 5k', target_date: '2026-08-15' }] })],
      '2026-08-01',
    );
    expect(out.some((w) => w.label === 'first 5k')).toBe(true);
    expect(out.some((w) => w.label === 'Run a 10k')).toBe(true);
  });

  it('ignores a milestone already reached — that is not a day to count toward', () => {
    const out = waypointsForGoals(
      [goal({ milestones: [{ id: 'm1', label: 'first 5k', target_date: '2026-08-15', done: true }] })],
      '2026-08-01',
    );
    expect(out.some((w) => w.label === 'first 5k')).toBe(false);
  });

  it('carries the span so the one-week line can say how far they have come', () => {
    const out = waypointsForGoals([goal({ timeframe: { start: '2026-08-20', end: '2026-09-19' } })], '2026-09-01');
    expect(out[0]?.totalDays).toBe(30);
  });

  it('omits the span when the goal has no start rather than guessing one', () => {
    const out = waypointsForGoals([goal({ timeframe: { end: '2026-09-19' } })], '2026-09-01');
    expect(out[0]?.totalDays).toBeUndefined();
  });

  it('carries the area, which picks the register the copy speaks in', () => {
    const out = waypointsForGoals([goal({ area: 'mind', title: 'morning pages' })], '2026-09-01');
    expect(out[0]?.area).toBe('mind');
  });

  it('orders soonest first, so a capped device keeps the ones that are actually near', () => {
    const out = waypointsForGoals(
      [goal({ timeframe: { end: '2027-01-01' } }), goal({ goal_id: 'g2', timeframe: { end: '2026-09-19' } })],
      '2026-08-01',
    );
    const dates = out.map((w) => w.date);
    expect([...dates].sort()).toEqual(dates);
  });

  it('produces nothing for a goal with no dates at all', () => {
    expect(waypointsForGoals([goal({ timeframe: {}, milestones: [] })], '2026-08-01')).toEqual([]);
    expect(waypointsForGoals([], '2026-08-01')).toEqual([]);
  });
});
