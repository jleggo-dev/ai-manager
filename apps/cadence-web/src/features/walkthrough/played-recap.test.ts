/**
 * The logs of a rearranged session, read back (walkthrough v3 Phase 6): a combined group logs
 * each turn and the Recap reads "Bench + row · circuit · 3 rounds" with the members' numbers
 * behind it; a spread step reads ONE line, "3×45 s · one at a time"; and `recapSummary` carries
 * both to the coach.
 */
import { describe, expect, it } from 'vitest';
import {
  type TurnLogs,
  type WalkthroughStep,
  applyShape,
  combine,
  defaultShape,
  moveTurnOut,
  split,
} from '@cadence/shared';
import { effectiveLogs, recapView } from './played-recap.ts';
import { logLine, recapSummary, stepFraction } from './state.ts';

const steps: WalkthroughStep[] = [
  { id: 's1', title: 'Pull-ups', minutes: 6, tool: { kind: 'reps', sets: 3, reps: 5 }, skippable: true },
  {
    id: 's2',
    title: 'Bench press',
    minutes: 9,
    tool: { kind: 'reps', sets: 3, reps: 8, load: '95 lb' },
    skippable: true,
  },
  {
    id: 's3',
    title: 'Dumbbell row',
    minutes: 9,
    tool: { kind: 'reps', sets: 3, reps: 10, load: '40 lb' },
    skippable: true,
  },
  {
    id: 's4',
    title: 'Dead hang',
    minutes: 3,
    tool: { kind: 'timer', seconds: 45, chime: true, sets: 3 },
    skippable: true,
  },
];

const pairShape = combine(defaultShape(steps), 'g2', 'g3', 'alternate');
const pairTurns: TurnLogs = {
  's2:0': { value: 8 },
  's3:0': { value: 10 },
  's2:1': { value: 8 },
  's3:1': { value: 10 },
  's2:2': { value: 6, load: '100 lb' },
  's3:2': { value: 10 },
};

describe('a combined group', () => {
  it('its played step carries a group log counting turns and rounds, and the line reads as a circuit', () => {
    const played = applyShape(steps, pairShape);
    const logs = effectiveLogs(played, {}, { 's2:0': { value: 8 }, 's3:0': { value: 10 }, 's2:1': { value: 8 } });
    const pair = played[1]!;
    expect(logs[pair.id]).toMatchObject({
      kind: 'group',
      mode: 'alternate',
      done: { turns: 3, rounds: 1 },
      total: { turns: 6, rounds: 3 },
    });
    expect(stepFraction(pair, logs[pair.id])).toBeCloseTo(0.5);
    expect(logLine(pair, logs[pair.id]!)).toBe('circuit · 1 of 3 rounds');
    expect(logs['s1']).toBeUndefined();
  });

  it('the recap lists it once, with each member’s own numbers behind, and the summary carries them', () => {
    const view = recapView(steps, pairShape, { s1: { kind: 'reps', sets: [5, 5, 5], target: 5 } }, pairTurns);
    expect(view.steps.map((s) => s.title)).toEqual(['Pull-ups', 'Bench + row', 'Dead hang']);
    const pair = view.steps[1]!;
    expect(logLine(pair, view.logs[pair.id]!)).toBe('circuit · 3 rounds');
    expect(view.logs[pair.id]).toMatchObject({
      members: [
        { title: 'Bench press', line: '3×[8,8,6] @ [95 lb, 95 lb, 100 lb] (plan said 95 lb)' },
        { title: 'Dumbbell row', line: '3×10 @ 40 lb' },
      ],
    });
    expect(recapSummary(view.steps, view.logs)).toBe(
      'pull-ups 3×5 · bench + row circuit · 3 rounds (bench press 3×[8,8,6] @ [95 lb, 95 lb, 100 lb] (plan said 95 lb), dumbbell row 3×10 @ 40 lb) · 1 step left',
    );
  });

  it('split back after two rounds: each step keeps the turns it logged, as its own sets', () => {
    const back = split(pairShape, 'g5');
    const played = applyShape(steps, back);
    const logs = effectiveLogs(
      played,
      {},
      { 's2:0': { value: 8 }, 's3:0': { value: 10 }, 's2:1': { value: 8 }, 's3:1': { value: 10 } },
    );
    expect(logs['s2']).toEqual({ kind: 'reps', sets: [8, 8], target: 8, load: '95 lb' });
    expect(logs['s3']).toEqual({ kind: 'reps', sets: [10, 10], target: 10, load: '40 lb' });
    // A step's own log, once its tool writes one, wins over the turns.
    const own = effectiveLogs(played, { s2: { kind: 'reps', sets: [9], target: 8 } }, { 's2:0': { value: 8 } });
    expect(own['s2']).toEqual({ kind: 'reps', sets: [9], target: 8 });
  });
});

describe('a spread step', () => {
  let shape = moveTurnOut(defaultShape(steps), 'g4', 0, 0);
  shape = moveTurnOut(shape, 'g4', 0, 2);
  const hangs: TurnLogs = { 's4:0': { value: 45 }, 's4:1': { value: 53 }, 's4:2': { value: 32 } };

  it('plays as three one-set steps, each with its own group log', () => {
    const played = applyShape(steps, shape);
    expect(played.map((p) => p.title)).toEqual([
      'Dead hang',
      'Pull-ups',
      'Dead hang',
      'Bench press',
      'Dumbbell row',
      'Dead hang',
    ]);
    const logs = effectiveLogs(played, {}, { 's4:0': { value: 45 } });
    expect(stepFraction(played[0]!, logs[played[0]!.id])).toBe(1);
    expect(logs[played[2]!.id]).toBeUndefined();
  });

  it('the recap reads ONE line, one at a time, where the first set was played', () => {
    const view = recapView(steps, shape, {}, hangs);
    expect(view.steps.map((s) => s.title)).toEqual(['Dead hang', 'Pull-ups', 'Bench press', 'Dumbbell row']);
    expect(logLine(view.steps[0]!, view.logs['s4']!)).toBe('45 · 53 · 32 s · one at a time');
    expect(recapSummary(view.steps, view.logs)).toBe('dead hang 45 · 53 · 32 s · one at a time · 3 steps left');
  });

  it('every set the same reads 3×45 s · one at a time', () => {
    const view = recapView(steps, shape, {}, { 's4:0': { value: 45 }, 's4:1': { value: 45 }, 's4:2': { value: 45 } });
    expect(logLine(view.steps[0]!, view.logs['s4']!)).toBe('3×45 s · one at a time');
  });

  it('near-miss: a set dragged out with two left together is not "one at a time" on the line either', () => {
    const two = moveTurnOut(defaultShape(steps), 'g4', 2, 0);
    const view = recapView(steps, two, {}, hangs);
    expect(logLine(view.steps[0]!, view.logs['s4']!)).toBe('45 · 53 · 32 s · one at a time');
  });
});

describe('nothing rearranged', () => {
  it('effectiveLogs and recapView hand the ordinary logs straight through', () => {
    const logs = { s1: { kind: 'reps' as const, sets: [5, 5, 5], target: 5 } };
    const played = applyShape(steps, defaultShape(steps));
    expect(effectiveLogs(played, logs, {})).toBe(logs);
    const view = recapView(steps, defaultShape(steps), logs, {});
    expect(view.steps).toEqual(steps);
    expect(view.logs).toEqual(logs);
  });
});
