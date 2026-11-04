/**
 * The played shape's operations (walkthrough v3 Phase 6a): every one is `old → new`, every table
 * has the positives and the near-misses, because a wrong move here opens the wrong set in the gym
 * and nothing throws.
 */
import { describe, expect, it } from 'vitest';
import {
  type PlayedShape,
  canRearrangeTurns,
  canUndo,
  combine,
  defaultShape,
  historyOf,
  isCombined,
  isDefaultShape,
  isPlain,
  moveGroup,
  moveTurnOut,
  nextGroupId,
  normalizeShape,
  pushShape,
  setCount,
  split,
  spreadSteps,
  turnKind,
  undoShape,
} from './played-shape.ts';
import { GYM, byTitle } from './played-fixture.test-helper.ts';

/** The item at `i`, which the table says is there. */
function at<T>(list: readonly T[], i: number): T {
  const x = list[i];
  if (x === undefined) throw new Error(`nothing at ${i}`);
  return x;
}

const ids = (shape: PlayedShape) => shape.map((g) => g.turns.map((t) => `${t.stepId}:${t.set}`).join(' '));
const groupIds = (shape: PlayedShape) => shape.map((g) => g.id);

describe('defaultShape — the prescription as written', () => {
  it('one group per step, one turn per set; a read, a circuit and a single hold are one turn', () => {
    const shape = defaultShape(GYM);
    expect(ids(shape)).toEqual([
      's1:0',
      's2:0 s2:1 s2:2',
      's3:0 s3:1 s3:2',
      's4:0 s4:1 s4:2',
      's5:0 s5:1 s5:2',
      's6:0 s6:1 s6:2',
      's7:0 s7:1',
      's8:0',
    ]);
    expect(groupIds(shape)).toEqual(['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8']);
    expect(shape.every((g) => isPlain(g, GYM))).toBe(true);
    expect(isDefaultShape(shape, GYM)).toBe(true);
  });

  it.each([
    ['reps, 3 sets', byTitle('Pull-ups').tool, 3, 'reps', true],
    ['timer in sets', byTitle('Dead hang').tool, 3, 'seconds', true],
    ['a single hold is one timed turn', { kind: 'timer', seconds: 60 } as const, 1, 'seconds', true],
    ['a prescribed circuit is one whole turn', byTitle('Abs circuit').tool, 1, 'whole', false],
    ['a read is one whole turn', byTitle('Warm-up').tool, 1, 'whole', false],
    ['a journal is one whole turn', { kind: 'journal', prompt: 'x', mode: 'either' } as const, 1, 'whole', false],
  ])('%s', (_name, tool, count, kind, rearrangeable) => {
    expect(setCount(tool)).toBe(count);
    expect(turnKind(tool)).toBe(kind);
    expect(canRearrangeTurns(tool)).toBe(rearrangeable);
  });
});

describe('combine — Alternate | Sequence', () => {
  const base = defaultShape(GYM);

  it('alternate: round by round, the earlier group first, in the earlier group’s place', () => {
    const shape = combine(base, 'g3', 'g4', 'alternate');
    expect(ids(shape)[2]).toBe('s3:0 s4:0 s3:1 s4:1 s3:2 s4:2');
    expect(groupIds(shape)).toEqual(['g1', 'g2', 'g9', 'g5', 'g6', 'g7', 'g8']);
    expect(at(shape, 2).mode).toBe('alternate');
    expect(isCombined(at(shape, 2))).toBe(true);
  });

  it('sequence: one group’s sets, then the other’s', () => {
    expect(ids(combine(base, 'g6', 'g7', 'sequence'))[5]).toBe('s6:0 s6:1 s6:2 s7:0 s7:1');
  });

  it('the order of the ids does not matter — position does', () => {
    expect(ids(combine(base, 'g4', 'g3', 'alternate'))).toEqual(ids(combine(base, 'g3', 'g4', 'alternate')));
  });

  it('unequal set counts alternate until the shorter runs out', () => {
    expect(ids(combine(base, 'g6', 'g7', 'alternate'))[5]).toBe('s6:0 s7:0 s6:1 s7:1 s6:2');
  });

  it('a combined group can take a third', () => {
    const two = combine(base, 'g3', 'g4', 'alternate');
    const three = combine(two, 'g9', 'g2', 'alternate');
    expect(ids(three)[1]).toBe('s2:0 s3:0 s4:0 s2:1 s3:1 s4:1 s2:2 s3:2 s4:2');
  });

  it.each([
    ['a group with itself', 'g3', 'g3'],
    ['an id that is not there', 'g3', 'g99'],
  ])('near-miss: %s changes nothing', (_n, a, b) => {
    expect(combine(base, a, b, 'alternate')).toBe(base);
  });
});

describe('split — a combined group back into its steps', () => {
  it('one group per step, turns in set order, in the combined group’s place', () => {
    const shape = split(combine(defaultShape(GYM), 'g3', 'g4', 'alternate'), 'g9');
    expect(ids(shape)).toEqual(ids(defaultShape(GYM)));
    expect(at(shape, 2).id).not.toBe('g3');
    expect(at(shape, 2).mode).toBeUndefined();
  });

  it('near-miss: a plain group cannot be split', () => {
    const base = defaultShape(GYM);
    expect(split(base, 'g3')).toBe(base);
  });
});

describe('moveGroup — drag a whole group into a gap', () => {
  const base = defaultShape(GYM);
  it.each([
    ['to the top', 'g5', 0, ['g5', 'g1', 'g2', 'g3', 'g4', 'g6', 'g7', 'g8']],
    ['to the end', 'g2', 8, ['g1', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8', 'g2']],
    ['later, past two groups', 'g2', 4, ['g1', 'g3', 'g4', 'g2', 'g5', 'g6', 'g7', 'g8']],
    ['earlier', 'g7', 2, ['g1', 'g2', 'g7', 'g3', 'g4', 'g5', 'g6', 'g8']],
  ])('%s', (_n, id, gap, expected) => {
    expect(groupIds(moveGroup(base, id, gap))).toEqual(expected);
  });

  it.each([
    ['the gap just above it', 'g3', 2],
    ['the gap just below it', 'g3', 3],
    ['an id that is not there', 'g99', 0],
  ])('near-miss: %s is not a move', (_n, id, gap) => {
    expect(moveGroup(base, id, gap)).toBe(base);
  });

  it('a gap past the end lands at the end', () => {
    expect(groupIds(moveGroup(base, 'g1', 40)).at(-1)).toBe('g1');
  });
});

describe('moveTurnOut — spread: one set into a gap', () => {
  const base = defaultShape(GYM);

  it('the set becomes its own group at the gap; the source keeps the rest', () => {
    const shape = moveTurnOut(base, 'g5', 2, 2);
    expect(ids(shape)).toEqual([
      's1:0',
      's2:0 s2:1 s2:2',
      's5:2',
      's3:0 s3:1 s3:2',
      's4:0 s4:1 s4:2',
      's5:0 s5:1',
      's6:0 s6:1 s6:2',
      's7:0 s7:1',
      's8:0',
    ]);
    expect(at(shape, 2).id).toBe('g9');
    expect(at(shape, 5).id).toBe('g5');
    expect(
      spreadSteps(shape)
        .get('s5')
        ?.map((g) => g.id),
    ).toEqual(['g9', 'g5']);
  });

  it('the owner’s case: three hangs spread through the session', () => {
    let shape = moveTurnOut(base, 'g5', 0, 1);
    shape = moveTurnOut(shape, 'g5', 0, 4);
    expect(ids(shape)).toEqual([
      's1:0',
      's5:0',
      's2:0 s2:1 s2:2',
      's3:0 s3:1 s3:2',
      's5:1',
      's4:0 s4:1 s4:2',
      's5:2',
      's6:0 s6:1 s6:2',
      's7:0 s7:1',
      's8:0',
    ]);
    expect(shape.filter((g) => g.turns[0]?.stepId === 's5').every((g) => g.turns.length === 1)).toBe(true);
  });

  it('a set dragged out of a combined group leaves the group combined with the rest', () => {
    const shape = moveTurnOut(combine(base, 'g3', 'g4', 'alternate'), 'g9', 5, 7);
    expect(ids(shape)[2]).toBe('s3:0 s4:0 s3:1 s4:1 s3:2');
    expect(isCombined(at(shape, 2))).toBe(true);
    expect(at(shape, 2).mode).toBe('alternate');
  });

  it('the only set of a one-set group moves the group instead', () => {
    expect(groupIds(moveTurnOut(base, 'g1', 0, 3))).toEqual(['g2', 'g3', 'g1', 'g4', 'g5', 'g6', 'g7', 'g8']);
  });

  it.each([
    ['a turn index past the end', 'g5', 7, 0],
    ['an id that is not there', 'g99', 0, 0],
  ])('near-miss: %s changes nothing', (_n, id, turn, gap) => {
    expect(moveTurnOut(base, id, turn, gap)).toBe(base);
  });
});

describe('normalizeShape — a shape that fits the steps', () => {
  it('a default shape comes back as it is', () => {
    const shape = defaultShape(GYM);
    expect(ids(normalizeShape(shape, GYM))).toEqual(ids(shape));
  });

  it('a set past the step’s count is dropped (a swap for fewer sets)', () => {
    const fewer = GYM.map((s) => (s.id === 's3' ? { ...s, tool: { kind: 'reps' as const, sets: 2, reps: 8 } } : s));
    expect(ids(normalizeShape(defaultShape(GYM), fewer))[2]).toBe('s3:0 s3:1');
  });

  it('a set the shape lost is put back after its step’s last group (a swap for more sets)', () => {
    const more = GYM.map((s) => (s.id === 's3' ? { ...s, tool: { kind: 'reps' as const, sets: 4, reps: 8 } } : s));
    const shape = combine(defaultShape(GYM), 'g3', 'g4', 'alternate');
    const fixed = normalizeShape(shape, more);
    expect(ids(fixed)[2]).toBe('s3:0 s4:0 s3:1 s4:1 s3:2 s4:2');
    expect(ids(fixed)[3]).toBe('s3:3');
  });

  it('a set lost from a plain group goes back into it', () => {
    const shape: PlayedShape = [{ id: 'g1', turns: [{ stepId: 's3', set: 0 }] }];
    expect(ids(normalizeShape(shape, [byTitle('Bench press')]))).toEqual(['s3:0 s3:1 s3:2']);
  });

  it('a step the shape never had gets a plain group at the end; an unknown step is dropped', () => {
    const shape: PlayedShape = [
      {
        id: 'g1',
        turns: [
          { stepId: 'ghost', set: 0 },
          { stepId: 's2', set: 0 },
          { stepId: 's2', set: 1 },
          { stepId: 's2', set: 2 },
        ],
      },
    ];
    expect(ids(normalizeShape(shape, [byTitle('Pull-ups'), byTitle('Dead hang')]))).toEqual([
      's2:0 s2:1 s2:2',
      's5:0 s5:1 s5:2',
    ]);
  });

  it('a turn that appears twice is kept once', () => {
    const shape: PlayedShape = [
      {
        id: 'g1',
        turns: [
          { stepId: 's2', set: 0 },
          { stepId: 's2', set: 1 },
          { stepId: 's2', set: 2 },
        ],
      },
      { id: 'g2', turns: [{ stepId: 's2', set: 1 }] },
    ];
    expect(ids(normalizeShape(shape, [byTitle('Pull-ups')]))).toEqual(['s2:0 s2:1 s2:2']);
  });

  it('nextGroupId never reuses an id', () => {
    expect(
      nextGroupId([
        { id: 'g3', turns: [] },
        { id: 'g12', turns: [] },
      ]),
    ).toBe('g13');
    expect(nextGroupId([])).toBe('g1');
  });
});

describe('undo — a stack of the shapes before', () => {
  it('each change is remembered, undo walks back, and a no-op is not remembered', () => {
    const base = defaultShape(GYM);
    let h = historyOf(base);
    expect(canUndo(h)).toBe(false);
    h = pushShape(h, combine(h.shape, 'g3', 'g4', 'alternate'));
    h = pushShape(h, moveGroup(h.shape, 'g99', 0)); // nothing happened
    expect(h.past).toHaveLength(1);
    h = pushShape(h, moveTurnOut(h.shape, 'g5', 0, 1));
    expect(canUndo(h)).toBe(true);
    h = undoShape(h);
    expect(ids(h.shape)[2]).toBe('s3:0 s4:0 s3:1 s4:1 s3:2 s4:2');
    h = undoShape(h);
    expect(h.shape).toBe(base);
    expect(undoShape(h)).toBe(h);
  });
});
