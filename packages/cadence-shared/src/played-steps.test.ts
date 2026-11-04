/**
 * The steps the shell shows for a shape, and the per-turn log's fold back into sets (walkthrough
 * v3 Phase 6a). The untouched case has to come back as the same objects: that is what keeps
 * every existing log, change and test keyed by step id working when nothing was rearranged.
 */
import { describe, expect, it } from 'vitest';
import { applyShape, foldTurns, groupProgress, turnMinutes, turnTarget, type TurnLogs } from './played-steps.ts';
import { combine, defaultShape, moveTurnOut } from './played-shape.ts';
import { GYM, byTitle } from './played-fixture.test-helper.ts';

/** The item at `i`, which the table says is there. */
function at<T>(list: readonly T[], i: number): T {
  const x = list[i];
  if (x === undefined) throw new Error(`nothing at ${i}`);
  return x;
}

describe('applyShape', () => {
  it('the default shape gives the steps back, same objects, no play', () => {
    const played = applyShape(GYM, defaultShape(GYM));
    expect(played).toHaveLength(GYM.length);
    played.forEach((p, i) => {
      expect(p).toBe(GYM[i]);
      expect(p.play).toBeUndefined();
    });
  });

  it('a combined group is one circuit step of its members, with the turns to play', () => {
    const played = applyShape(GYM, combine(defaultShape(GYM), 'g3', 'g4', 'alternate'));
    expect(played.map((p) => p.title)).toEqual([
      'Warm-up',
      'Pull-ups',
      'Bench press + dumbbell row',
      'Dead hang',
      'Farmer carry',
      'Hip thrust',
      'Abs circuit',
    ]);
    const pair = at(played, 2);
    expect(pair.id).toBe('g9');
    expect(pair.minutes).toBe(18);
    expect(pair.tool).toEqual({
      kind: 'circuit',
      rounds: 3,
      exercises: [
        { name: 'Bench press', reps: 8, load: '95 lb' },
        { name: 'Dumbbell row', reps: 10, load: '40 lb' },
      ],
    });
    expect(pair.play).toEqual({
      groupId: 'g9',
      mode: 'alternate',
      rounds: 3,
      names: ['Bench press', 'Dumbbell row'],
      turns: [
        { stepId: 's3', set: 0 },
        { stepId: 's4', set: 0 },
        { stepId: 's3', set: 1 },
        { stepId: 's4', set: 1 },
        { stepId: 's3', set: 2 },
        { stepId: 's4', set: 2 },
      ],
    });
    // The steps around it are untouched.
    expect(played[1]).toBe(byTitle('Pull-ups'));
  });

  it('a spread set is its own one-turn step in the new place, keeping the step’s words and tool', () => {
    const played = applyShape(GYM, moveTurnOut(defaultShape(GYM), 'g5', 0, 1));
    const single = at(played, 1);
    expect(single.title).toBe('Dead hang');
    expect(single.id).toBe('g9');
    expect(single.tool).toBe(byTitle('Dead hang').tool);
    expect(single.minutes).toBe(1);
    expect(single.play).toEqual({ groupId: 'g9', rounds: 1, names: ['Dead hang'], turns: [{ stepId: 's5', set: 0 }] });
    // The source group, two sets left, is no longer plain either.
    const rest = played.find((p) => p.id === 'g5');
    expect(rest?.play?.turns).toEqual([
      { stepId: 's5', set: 1 },
      { stepId: 's5', set: 2 },
    ]);
    expect(rest?.minutes).toBe(2);
  });

  it('a stale shape is normalized on the way in', () => {
    const played = applyShape(GYM, [{ id: 'g1', turns: [{ stepId: 'gone', set: 0 }] }]);
    expect(played.map((p) => p.id)).toEqual(GYM.map((s) => s.id));
  });
});

describe('turnTarget and turnMinutes', () => {
  it.each([
    ['reps with a load', byTitle('Bench press'), { kind: 'reps', value: 8, load: '95 lb' }, 3],
    ['a timed set', byTitle('Dead hang'), { kind: 'seconds', value: 45 }, 1],
    ['a carry with a load', byTitle('Farmer carry'), { kind: 'seconds', value: 45, load: '2×40 lb' }, 2],
    ['a read is one whole turn', byTitle('Warm-up'), { kind: 'reps' }, 6],
  ] as const)('%s', (_n, step, target, minutes) => {
    expect(turnTarget(step)).toEqual(target);
    expect(turnMinutes(step)).toBe(minutes);
  });
});

describe('foldTurns — a step’s logged turns, back into sets', () => {
  const turns = [
    { stepId: 's3', set: 0 },
    { stepId: 's4', set: 0 },
    { stepId: 's3', set: 1 },
    { stepId: 's4', set: 1 },
    { stepId: 's3', set: 2 },
    { stepId: 's4', set: 2 },
  ];

  it('in set order, only this step’s, only the logged ones; loads only when one differs from the plan', () => {
    const logs: TurnLogs = { 's3:0': { value: 8 }, 's4:0': { value: 10 }, 's3:1': { value: 7 } };
    expect(foldTurns('s3', turns, logs, '95 lb')).toEqual({ sets: [8, 7] });
    expect(foldTurns('s4', turns, logs, '40 lb')).toEqual({ sets: [10] });
    expect(foldTurns('s5', turns, logs)).toBeNull();
  });

  it('a set done at another load brings the loads list, the plan filling the sets that kept it', () => {
    const logs: TurnLogs = {
      's3:0': { value: 8 },
      's3:1': { value: 8, load: '100 lb' },
      's3:2': { value: 6, load: '100 lb' },
    };
    expect(foldTurns('s3', turns, logs, '95 lb')).toEqual({ sets: [8, 8, 6], loads: ['95 lb', '100 lb', '100 lb'] });
  });

  it('a turn logged out of set order still folds in set order', () => {
    const logs: TurnLogs = { 's3:2': { value: 6 }, 's3:0': { value: 8 } };
    expect(foldTurns('s3', turns, logs)).toEqual({ sets: [8, 6] });
  });

  it('groupProgress counts turns and the rounds fully done', () => {
    expect(groupProgress(turns, { 's3:0': { value: 8 }, 's4:0': { value: 10 }, 's3:1': { value: 8 } })).toEqual({
      turns: 3,
      rounds: 1,
    });
    expect(groupProgress(turns, {})).toEqual({ turns: 0, rounds: 0 });
    expect(groupProgress(turns, Object.fromEntries(turns.map((t) => [`${t.stepId}:${t.set}`, { value: 1 }])))).toEqual({
      turns: 6,
      rounds: 3,
    });
  });
});
