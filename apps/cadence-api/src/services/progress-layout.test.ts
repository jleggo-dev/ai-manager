import { describe, expect, it } from 'vitest';
import type { Goal } from '@cadence/shared';
import { defaultLayout } from './progress-layout.ts';

/** Minimal, explicit Goal fixture — every test spells out goal_id/title/area/type so assertions
 *  read directly off the fixture, and a non-numeric default target so a goal is inert to every
 *  classifier unless a test deliberately overrides `measure`. */
function goal(over: Partial<Goal> & Pick<Goal, 'goal_id' | 'title' | 'area' | 'type'>): Goal {
  return {
    measure: { metric: 'generic', target: 'n/a' },
    timeframe: {},
    status: 'confirmed',
    linked_equipment: [],
    source: 'captured',
    ...over,
  };
}

const kinds = (layout: ReturnType<typeof defaultLayout>) => layout.sections.map((s) => s.kind);
const ids = (layout: ReturnType<typeof defaultLayout>) => layout.sections.map((s) => s.id);

describe('defaultLayout', () => {
  it('zero goals: still returns history, nothing else conditional fires', () => {
    const layout = defaultLayout([]);
    expect(layout.version).toBe(1);
    expect(layout.status).toBe('default');
    expect(kinds(layout)).toEqual(['recap_rail', 'history']);
    expect(ids(layout)).toEqual(['w-recap', 'w-history']);
  });

  it('weight-goal-only: trend_vs_target AND nourishment engagement (a weight goal IS a nourishment-area goal)', () => {
    const weight = goal({
      goal_id: 'weight-1',
      title: 'Lose 15 lb',
      area: 'nourishment',
      type: 'target',
      measure: { metric: 'weight', target: 150, unit: 'lb' },
    });
    const layout = defaultLayout([weight]);
    expect(kinds(layout)).toEqual(['trend_vs_target', 'weekly_bars', 'variety', 'shelf', 'recap_rail', 'history']);
    expect(ids(layout)).toEqual(['w-goal-weight-1', 'w-kcal', 'w-variety', 'w-shelf', 'w-recap', 'w-history']);
    const trend = layout.sections[0]!;
    expect(trend.source).toEqual({ measure: 'weight' });
    expect(trend.title).toBe('Lose 15 lb');
    const kcalBars = layout.sections[1]!;
    expect(kcalBars.source).toEqual({ measure: 'kcal' });
  });

  it('fitness-shaped user: rhythm first, then weight, activity, steps, nourishment — no mind/practice widgets', () => {
    const runSchedule = goal({ goal_id: 'run-sched', title: '3 runs a week', area: 'movement', type: 'recurring' });
    const weight = goal({
      goal_id: 'weight-2',
      title: 'Get to 180 lb',
      area: 'nourishment',
      type: 'target',
      measure: { metric: 'weight', target: 180, unit: 'lb' },
    });
    const marathon = goal({
      goal_id: 'marathon-1',
      title: 'Sub-4 marathon',
      area: 'movement',
      type: 'milestone',
      measure: { metric: 'distance', target: 42.2, unit: 'km' },
    });
    const layout = defaultLayout([runSchedule, weight, marathon]);

    expect(kinds(layout)).toEqual([
      'rhythm',
      'trend_vs_target',
      'dated_sessions',
      'weekly_bars', // steps
      'weekly_bars', // kcal
      'variety',
      'shelf',
      'recap_rail',
      'history',
    ]);
    expect(ids(layout)).toEqual([
      'w-rhythm',
      'w-goal-weight-2',
      'w-goal-marathon-1',
      'w-steps',
      'w-kcal',
      'w-variety',
      'w-shelf',
      'w-recap',
      'w-history',
    ]);
    const datedSessions = layout.sections[2]!;
    expect(datedSessions.source).toEqual({ activity: 'Sub-4 marathon' });
    expect(datedSessions.title).toBe('Sub-4 marathon');
    const steps = layout.sections[3]!;
    expect(steps.source).toEqual({ measure: 'steps' });
  });

  it('practice-only user (no movement/nourishment goals): shelf, balance, total, count/stage, THEN rhythm — no time-axis kind above the practice block', () => {
    const meditate = goal({ goal_id: 'meditate-sched', title: 'Meditate daily', area: 'mind', type: 'recurring' });
    const sitMinutes = goal({
      goal_id: 'sit-minutes',
      title: 'Sit for 1000 minutes this year',
      area: 'mind',
      type: 'target',
      measure: { metric: 'minutes', target: 1000, unit: 'minutes' },
    });
    const readBooks = goal({
      goal_id: 'read-books',
      title: 'Read 100 books',
      area: 'practice',
      type: 'target',
      measure: { metric: 'count', target: 100, unit: 'book' },
    });
    const readBible = goal({
      goal_id: 'read-bible',
      title: 'Read the whole Bible',
      area: 'practice',
      type: 'milestone',
      milestones: [
        { id: 'm1', label: 'Old Testament' },
        { id: 'm2', label: 'New Testament' },
      ],
    });
    const layout = defaultLayout([meditate, sitMinutes, readBooks, readBible]);

    expect(kinds(layout)).toEqual([
      'shelf',
      'balance',
      'total',
      'count_toward',
      'stage_path',
      'rhythm',
      'recap_rail',
      'history',
    ]);
    expect(ids(layout)).toEqual([
      'w-shelf',
      'w-balance',
      'w-goal-sit-minutes',
      'w-goal-read-books',
      'w-goal-read-bible-stage',
      'w-rhythm',
      'w-recap',
      'w-history',
    ]);
    const balance = layout.sections[1]!;
    expect(balance.source).toEqual({ feedback_kind: 'mind' });
    const total = layout.sections[2]!;
    expect(total.source).toEqual({ goal_id: 'sit-minutes' });
    const countToward = layout.sections[3]!;
    expect(countToward.source).toEqual({ goal_id: 'read-books' });
    const stagePath = layout.sections[4]!;
    expect(stagePath.source).toEqual({ goal_id: 'read-bible' });
  });

  it('mixed user: fitness-led path still carries the mind/practice widgets, in the fitness-first slot', () => {
    const runSchedule = goal({ goal_id: 'run-sched-2', title: 'Runs', area: 'movement', type: 'recurring' });
    const weight = goal({
      goal_id: 'weight-3',
      title: 'Weigh-in target',
      area: 'nourishment',
      type: 'target',
      measure: { metric: 'weight', target: 70, unit: 'kg' },
    });
    const readBooks = goal({
      goal_id: 'read-books-2',
      title: 'Read 50 books',
      area: 'practice',
      type: 'target',
      measure: { metric: 'count', target: 50, unit: 'book' },
    });
    const sitMinutes = goal({
      goal_id: 'sit-minutes-2',
      title: 'Sit for 500 minutes',
      area: 'mind',
      type: 'target',
      measure: { metric: 'minutes', target: 500, unit: 'minutes' },
    });
    const layout = defaultLayout([runSchedule, weight, readBooks, sitMinutes]);

    expect(kinds(layout)).toEqual([
      'rhythm',
      'trend_vs_target',
      'weekly_bars', // steps
      'weekly_bars', // kcal
      'variety',
      'count_toward',
      'balance',
      'total',
      'shelf',
      'recap_rail',
      'history',
    ]);
  });

  it('a movement goal with a countable unit (e.g. "10 races") is count_toward, not dated_sessions — no id collision', () => {
    const races = goal({
      goal_id: 'races-1',
      title: 'Run 10 races',
      area: 'movement',
      type: 'target',
      measure: { metric: 'count', target: 10, unit: 'races' },
    });
    const layout = defaultLayout([races]);
    expect(kinds(layout)).toEqual(['weekly_bars', 'count_toward', 'shelf', 'recap_rail', 'history']);
    const countToward = layout.sections[1]!;
    expect(countToward.kind).toBe('count_toward');
    expect(countToward.source).toEqual({ goal_id: 'races-1' });
  });

  it('a goal that is both a weight goal and has stepping-stones gets trend_vs_target AND stage_path with distinct ids', () => {
    const g = goal({
      goal_id: 'weight-4',
      title: 'Lose it in stages',
      area: 'nourishment',
      type: 'milestone',
      measure: { metric: 'weight', target: 160, unit: 'lb' },
      milestones: [{ id: 'm1', label: 'First 5' }],
    });
    const layout = defaultLayout([g]);
    // Weight (trend_vs_target) sits in the weight-goal slot; nourishment engagement (kcal/variety)
    // follows, since a weight goal IS a nourishment-area goal; stage_path sits in the later
    // count/stage-path slot — same goal, two independent, non-colliding widget ids.
    expect(kinds(layout)).toEqual([
      'trend_vs_target',
      'weekly_bars',
      'variety',
      'stage_path',
      'shelf',
      'recap_rail',
      'history',
    ]);
    expect(ids(layout)).toEqual([
      'w-goal-weight-4',
      'w-kcal',
      'w-variety',
      'w-goal-weight-4-stage',
      'w-shelf',
      'w-recap',
      'w-history',
    ]);
  });
});
