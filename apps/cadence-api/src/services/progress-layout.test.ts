import { describe, expect, it } from 'vitest';
import type { Goal } from '@cadence/shared';
import { defaultLayout, stampGoalFacts } from './progress-layout.ts';

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

  it('a practice goal with repertoire items leads its page with the repertoire card; without items (or without the fact passed) none derives', () => {
    const piano = goal({ goal_id: 'piano-1', title: 'Learn the piano', area: 'practice', type: 'milestone' });
    const withItems = defaultLayout([piano], { repertoire_goal_ids: ['piano-1'] });
    expect(kinds(withItems)).toEqual(['repertoire', 'shelf', 'balance', 'recap_rail', 'history']);
    const card = withItems.sections[0]!;
    expect(card.id).toBe('w-goal-piano-1-repertoire');
    expect(card.title).toBe('Learn the piano');
    expect(card.source).toEqual({ goal_id: 'piano-1' });
    expect(card.area).toBe('practice');

    const without = ['shelf', 'balance', 'recap_rail', 'history'];
    expect(kinds(defaultLayout([piano], { repertoire_goal_ids: [] }))).toEqual(without);
    expect(kinds(defaultLayout([piano]))).toEqual(without);
  });

  it('on the fitness-led path a practice goal with items still gets its repertoire card, in the goal-scoped block', () => {
    const runSchedule = goal({ goal_id: 'run-sched-3', title: 'Runs', area: 'movement', type: 'recurring' });
    const piano = goal({ goal_id: 'piano-2', title: 'Learn the piano', area: 'practice', type: 'milestone' });
    const layout = defaultLayout([runSchedule, piano], { repertoire_goal_ids: ['piano-2'] });
    expect(kinds(layout)).toEqual(['rhythm', 'weekly_bars', 'repertoire', 'balance', 'shelf', 'recap_rail', 'history']);
  });

  it('a mind goal plus felt data gets felt_week ALONGSIDE balance — different sources, both honest', () => {
    const calm = goal({ goal_id: 'calm-1', title: 'Calmer evenings', area: 'mind', type: 'recurring' });
    const layout = defaultLayout([calm], { has_felt: true });
    expect(kinds(layout)).toEqual(['shelf', 'balance', 'felt_week', 'rhythm', 'recap_rail', 'history']);
    const felt = layout.sections.find((s) => s.kind === 'felt_week')!;
    // One mind goal: the card is that goal's, and wears its area for the chip.
    expect(felt).toMatchObject({ id: 'w-felt', title: 'Calmer evenings', area: 'mind' });
    expect(felt.source).toBeUndefined();

    // No felt data (or the fact not passed): no felt_week — absent data never derives a card.
    expect(kinds(defaultLayout([calm], { has_felt: false }))).not.toContain('felt_week');
    expect(kinds(defaultLayout([calm]))).not.toContain('felt_week');
    // Practice-only goals don't reach for the daily mood either.
    const readBooks = goal({ goal_id: 'rb', title: 'Read 100 books', area: 'practice', type: 'target' });
    expect(kinds(defaultLayout([readBooks], { has_felt: true }))).not.toContain('felt_week');
  });

  it('two mind goals share one felt_week card with a measure-named title and no stamped area', () => {
    const calm = goal({ goal_id: 'calm-2', title: 'Calmer evenings', area: 'mind', type: 'recurring' });
    const sleep = goal({ goal_id: 'sleep-1', title: 'Sleep by eleven', area: 'mind', type: 'recurring' });
    const layout = defaultLayout([calm, sleep], { has_felt: true });
    const felt = layout.sections.find((s) => s.kind === 'felt_week')!;
    expect(felt.title).toBe('How your days felt');
    expect(felt.area).toBeUndefined();
  });

  it('with logged sessions on file, then_now sits below the goal cards, above the page furniture — on both paths', () => {
    const runSchedule = goal({ goal_id: 'run-tn', title: 'Runs', area: 'movement', type: 'recurring' });
    const fitness = defaultLayout([runSchedule], { has_then_now: true });
    expect(kinds(fitness)).toEqual(['rhythm', 'weekly_bars', 'shelf', 'then_now', 'recap_rail', 'history']);
    const card = fitness.sections.find((s) => s.kind === 'then_now')!;
    // Cross-goal: no source, no stamped goal facts.
    expect(card).toEqual({ id: 'w-then-now', kind: 'then_now', title: 'Then → now' });

    const calm = goal({ goal_id: 'calm-tn', title: 'Calmer evenings', area: 'mind', type: 'recurring' });
    const practice = defaultLayout([calm], { has_then_now: true });
    expect(kinds(practice)).toEqual(['shelf', 'balance', 'rhythm', 'then_now', 'recap_rail', 'history']);

    // No logged sessions (or the fact not passed): no card — absent data never derives one.
    expect(kinds(defaultLayout([runSchedule], { has_then_now: false }))).not.toContain('then_now');
    expect(kinds(defaultLayout([runSchedule]))).not.toContain('then_now');
  });

  it('photo_pair derives only for an opted-in user with photos, after the then_now slot', () => {
    const runSchedule = goal({ goal_id: 'run-pp', title: 'Runs', area: 'movement', type: 'recurring' });
    const layout = defaultLayout([runSchedule], { has_then_now: true, has_photos: true });
    expect(kinds(layout)).toEqual([
      'rhythm',
      'weekly_bars',
      'shelf',
      'then_now',
      'photo_pair',
      'recap_rail',
      'history',
    ]);
    const card = layout.sections.find((s) => s.kind === 'photo_pair')!;
    // Cross-goal and opt-in: no source, no stamped goal facts.
    expect(card).toEqual({ id: 'w-photos', kind: 'photo_pair', title: 'Your photos' });

    // Off (the default), or on with nothing added yet: no card.
    expect(kinds(defaultLayout([runSchedule], { has_photos: false }))).not.toContain('photo_pair');
    expect(kinds(defaultLayout([runSchedule]))).not.toContain('photo_pair');
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

describe('goal facts on specs (owner design "Cadence Progress": chip family + deadline tag)', () => {
  it('per-goal sections carry the goal area and deadline; cross-goal sections carry neither', () => {
    const race = goal({
      goal_id: 'race-1',
      title: 'Obstacle race',
      area: 'movement',
      type: 'milestone',
      timeframe: { end: '2026-10-04' },
      milestones: [{ id: 'm1', label: '5k without stopping' }],
    });
    const layout = defaultLayout([race]);
    const stage = layout.sections.find((s) => s.kind === 'stage_path')!;
    expect(stage.area).toBe('movement');
    expect(stage.deadline).toBe('2026-10-04');
    const shelf = layout.sections.find((s) => s.kind === 'shelf')!;
    expect(shelf.area).toBeUndefined();
    expect(shelf.deadline).toBeUndefined();
  });

  it('stampGoalFacts overwrites model-written facts on goal-linked sections and leaves the rest', () => {
    const race = goal({
      goal_id: 'race-1',
      title: 'Obstacle race',
      area: 'movement',
      type: 'milestone',
      timeframe: { end: '2026-10-04' },
    });
    const stamped = stampGoalFacts(
      {
        version: 1,
        status: 'draft',
        sections: [
          // The model wrote a wrong area — the goal row wins.
          { id: 'a', kind: 'stage_path', source: { goal_id: 'race-1' }, area: 'practice' },
          { id: 'b', kind: 'shelf' },
        ],
      },
      [race],
    );
    expect(stamped.sections[0]).toMatchObject({ area: 'movement', deadline: '2026-10-04' });
    expect(stamped.sections[1]!.area).toBeUndefined();
  });
});
