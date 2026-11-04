/**
 * What the person changed about a move (walkthrough v3 Phase 5): the pure model the shell derives
 * its steps from. Every function here is a router that fails silently — the wrong step plays, the
 * wrong rows show — so each gets a table with its near-misses.
 */
import { describe, expect, it } from 'vitest';
import type { SessionItemAlternative, WalkthroughStep } from '@cadence/shared';
import {
  applyChanges,
  changeKey,
  changeSubtitle,
  dialStart,
  swapRows,
  takesLoad,
  workingLoad,
  type MoveChanges,
} from './changes.ts';

const thrust: SessionItemAlternative = {
  name: 'Kettlebell hip thrust',
  sets: 2,
  reps: 12,
  load: '40 lb',
  detail: 'Shoulders on the bench.',
  video_query: 'kettlebell hip thrust form',
  equipment: ['Bench', 'kettlebell'],
};
const carry: SessionItemAlternative = {
  name: 'Farmer carry',
  sets: 3,
  duration_min: 0.75,
  load: '2×40 lb',
  equipment: ['kettlebells'],
};
const clamshell: SessionItemAlternative = { name: 'Banded clamshell', sets: 2, reps: 15, equipment: ['Light band'] };

const bridge: WalkthroughStep = {
  id: 's3',
  title: 'Glute bridge',
  body: 'Squeeze at the top.',
  video_query: 'glute bridge form',
  minutes: 3,
  skippable: true,
  tool: { kind: 'reps', sets: 2, reps: 12, load: 'bodyweight' },
  alternatives: [thrust, clamshell],
  suggested_load: '15 lb',
};
const walk: WalkthroughStep = { id: 's4', title: 'Walk it off', minutes: 5, skippable: true, tool: { kind: 'read' } };
const circuit: WalkthroughStep = {
  id: 's5',
  title: 'Abs circuit',
  minutes: 9,
  skippable: true,
  tool: {
    kind: 'circuit',
    rounds: 3,
    exercises: [
      { name: 'Plank', seconds: 30 },
      { name: 'Glute bridge', reps: 12, alternatives: [thrust] },
    ],
  },
};

describe('applyChanges', () => {
  it('no changes: the very same steps', () => {
    const steps = [bridge, walk];
    expect(applyChanges(steps, {})).toBe(steps);
  });

  it('a swap plays the alternative: its name, tool, cue and video, and says what it replaced', () => {
    const [s] = applyChanges([bridge], { s3: { swap: thrust } });
    expect(s).toMatchObject({
      id: 's3',
      title: 'Kettlebell hip thrust',
      body: 'Shoulders on the bench.',
      video_query: 'kettlebell hip thrust form',
      swapped_from: 'Glute bridge',
      tool: { kind: 'reps', sets: 2, reps: 12, load: '40 lb' },
    });
    // The list of alternatives and the suggestion stay the prescribed move's.
    expect(s!.alternatives).toBe(bridge.alternatives);
    expect(s!.suggested_load).toBe('15 lb');
  });

  it('an alternative without a cue or video drops the original ones rather than keeping them', () => {
    const [s] = applyChanges([bridge], { s3: { swap: clamshell } });
    expect(s!.body).toBeUndefined();
    expect(s!.video_query).toBeUndefined();
  });

  it('an alternative done in timed sets plays as the timer in sets', () => {
    const [s] = applyChanges([bridge], { s3: { swap: carry } });
    expect(s!.tool).toMatchObject({ kind: 'timer', seconds: 45, sets: 3, load: '2×40 lb' });
  });

  it('a load alone changes nothing about the step — the plan stays the plan', () => {
    const [s] = applyChanges([bridge], { s3: { load: '15 lb' } });
    expect(s).toBe(bridge);
  });

  it('undo is a delete: the prescribed step comes back untouched', () => {
    const changes: MoveChanges = { s3: { swap: thrust } };
    expect(applyChanges([bridge], changes)[0]!.swapped_from).toBe('Glute bridge');
    expect(applyChanges([bridge], {})[0]).toBe(bridge);
  });

  it('a circuit move swaps in place, keyed by move index, and the other moves are the same objects', () => {
    const [s] = applyChanges([circuit], { [changeKey('s5', 1)]: { swap: thrust } });
    expect(s!.tool.kind).toBe('circuit');
    if (s!.tool.kind !== 'circuit' || circuit.tool.kind !== 'circuit') throw new Error('circuit');
    expect(s!.tool.exercises[0]).toBe(circuit.tool.exercises[0]);
    expect(s!.tool.exercises[1]).toMatchObject({
      name: 'Kettlebell hip thrust',
      reps: 12,
      load: '40 lb',
      detail: 'Shoulders on the bench.',
      swapped_from: 'Glute bridge',
      alternatives: [thrust],
    });
    expect(s!.swapped_from).toBeUndefined();
  });

  it('a change keyed to a move that is not in the walkthrough changes nothing', () => {
    expect(applyChanges([bridge], { s9: { swap: thrust } })[0]).toBe(bridge);
  });
});

describe('swapRows — which rows the sheet lists', () => {
  it.each<[string, SessionItemAlternative[] | undefined, string, SessionItemAlternative[], string[]]>([
    ['no alternatives, nothing landed', undefined, 'Glute bridge', [], []],
    [
      "the coach's alternatives",
      [thrust, clamshell],
      'Glute bridge',
      [],
      ['Kettlebell hip thrust', 'Banded clamshell'],
    ],
    [
      'the move being played is not offered to itself',
      [thrust, clamshell],
      'Kettlebell hip thrust',
      [],
      ['Banded clamshell'],
    ],
    [
      'a landed answer joins the list after hers',
      [thrust],
      'Glute bridge',
      [carry],
      ['Kettlebell hip thrust', 'Farmer carry'],
    ],
    [
      'a landed answer she already gave is not listed twice',
      [thrust],
      'Glute bridge',
      [{ ...thrust, name: 'kettlebell hip thrust' }],
      ['Kettlebell hip thrust'],
    ],
    ['only landed answers, no alternatives', undefined, 'Glute bridge', [carry], ['Farmer carry']],
  ])('%s', (_name, alternatives, playing, landed, expected) => {
    expect(swapRows(alternatives, playing, landed).map((a) => a.name)).toEqual(expected);
  });
});

describe('changeSubtitle — facts in caps', () => {
  it.each<[string, Parameters<typeof changeSubtitle>, string]>([
    ['set 1 next', ['Glute bridge', bridge.tool, undefined], 'GLUTE BRIDGE · SET 1 OF 2 NEXT'],
    ['one set logged', ['Glute bridge', bridge.tool, { kind: 'reps', sets: [12] }], 'GLUTE BRIDGE · SET 2 OF 2 NEXT'],
    ['all logged', ['Glute bridge', bridge.tool, { kind: 'reps', sets: [12, 12] }], 'GLUTE BRIDGE · 2 SETS LOGGED'],
    [
      'timed sets',
      ['Dead hang', { kind: 'timer', seconds: 30, sets: 3 }, { kind: 'timed_sets', sets: [30], targetSec: 30 }],
      'DEAD HANG · SET 2 OF 3 NEXT',
    ],
    ['a plain hold has no sets', ['Plank', { kind: 'timer', seconds: 60 }, undefined], 'PLANK'],
    [
      'a circuit move names the move and the round',
      ['Abs circuit', circuit.tool, undefined, 1, 1],
      'GLUTE BRIDGE · ROUND 2 OF 3',
    ],
  ])('%s', (_name, args, expected) => {
    expect(changeSubtitle(...args)).toBe(expected);
  });
});

describe('takesLoad — which moves get an Add weight row', () => {
  it.each<[string, WalkthroughStep['tool'], boolean]>([
    ['reps', { kind: 'reps', sets: 2, reps: 12 }, true],
    ['timed sets', { kind: 'timer', seconds: 45, sets: 3 }, true],
    ['a circuit', circuit.tool, true],
    ['a plain hold', { kind: 'timer', seconds: 300 }, false],
    ['a read', { kind: 'read' }, false],
    ['a journal', { kind: 'journal', prompt: 'x', mode: 'either' }, false],
    ['a measure', { kind: 'measure', metric: 'Weight', unit: 'kg' }, false],
  ])('%s', (_name, tool, expected) => {
    expect(takesLoad(tool)).toBe(expected);
  });
});

describe('the small ones', () => {
  it('changeKey keys a step, or a move inside it', () => {
    expect(changeKey('s3')).toBe('s3');
    expect(changeKey('s5', 1)).toBe('s5:1');
  });
  it('workingLoad reads the load or nothing', () => {
    expect(workingLoad({ s3: { load: '15 lb' } }, 's3')).toBe('15 lb');
    expect(workingLoad({ s3: { swap: thrust } }, 's3')).toBeUndefined();
    expect(workingLoad({}, 's3')).toBeUndefined();
  });
  it('dialStart: the working load, else a numeric plan load, else the suggestion, else none — never a load it cannot read', () => {
    expect(dialStart('20 lb', '40 lb', '15 lb')).toBe(20);
    expect(dialStart(undefined, '40 lb', '15 lb')).toBe(40);
    expect(dialStart(undefined, 'bodyweight', '15 lb')).toBe(15);
    expect(dialStart('bodyweight', '2×40 lb', 'light band')).toBe(0);
    expect(dialStart(undefined, undefined, undefined)).toBe(0);
  });
});
