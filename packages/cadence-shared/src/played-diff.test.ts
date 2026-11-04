/**
 * The structure diff's words (walkthrough v3 Phase 6b/6c) and the how_to append (R5). Fixed copy,
 * so the table IS the copy: change a word here and the Recap changes with it.
 */
import { describe, expect, it } from 'vitest';
import { appendHowTo, structureDiff } from './played-diff.ts';
import { combine, defaultShape, moveGroup, moveTurnOut } from './played-shape.ts';
import { GYM } from './played-fixture.test-helper.ts';

const plain = GYM.map((s) => {
  const { swapped_from: _drop, ...rest } = s;
  return rest;
});

describe('structureDiff — the changes as facts', () => {
  it('nothing rearranged, nothing swapped: no changes', () => {
    expect(structureDiff(plain, defaultShape(plain))).toEqual([]);
  });

  it('the owner’s session: presses and rows alternating, hangs one at a time, a swap', () => {
    let shape = combine(defaultShape(GYM), 'g3', 'g4', 'alternate');
    shape = moveTurnOut(shape, 'g5', 0, 1);
    shape = moveTurnOut(shape, 'g5', 0, 4);
    // In the order they sit in the session: the first hang now comes before the pair.
    expect(structureDiff(GYM, shape)).toEqual([
      { kind: 'spread', key: 'spread:s5', words: 'Dead hang, one set at a time', sentence: 'dead hang one set at a time' },
      {
        kind: 'alternate',
        key: 'alternate:s3+s4',
        words: 'Bench press + dumbbell row, alternating',
        sentence: 'alternate bench press and dumbbell row',
        pills: ['Bench', 'Row', 'Bench', 'Row'],
        rounds: 3,
      },
      { kind: 'swap', key: 'swap:s7', words: 'Glute bridge → hip thrust', sentence: 'hip thrust instead of glute bridge' },
    ]);
  });

  it('a sequence is said as one then the other', () => {
    expect(structureDiff(plain, combine(defaultShape(plain), 'g6', 'g7', 'sequence'))).toEqual([
      {
        kind: 'sequence',
        key: 'sequence:s6+s7',
        words: 'Farmer carry + hip thrust, in sequence',
        sentence: 'farmer carry, then hip thrust',
        pills: ['Carry', 'Carry', 'Carry', 'Thrust'],
        rounds: 3,
      },
    ]);
  });

  it('a set dragged out with two left together is "in 2 places", not "one at a time"', () => {
    const shape = moveTurnOut(defaultShape(plain), 'g5', 2, 1);
    expect(structureDiff(plain, shape)).toEqual([
      { kind: 'spread', key: 'spread:s5', words: 'Dead hang, in 2 places', sentence: 'dead hang in 2 places' },
    ]);
  });

  it('a whole group dragged elsewhere is named with what it now follows', () => {
    expect(structureDiff(plain, moveGroup(defaultShape(plain), 'g5', 2))).toEqual([
      { kind: 'reorder', key: 'reorder:s5', words: 'Dead hang after pull-ups', sentence: 'dead hang after pull-ups' },
    ]);
    expect(structureDiff(plain, moveGroup(defaultShape(plain), 'g5', 0))).toEqual([
      { kind: 'reorder', key: 'reorder:s5', words: 'Dead hang first', sentence: 'dead hang first' },
    ]);
  });

  it('near-miss: combining two non-adjacent groups is not also a reorder', () => {
    const kinds = structureDiff(plain, combine(defaultShape(plain), 'g2', 'g6', 'alternate')).map((c) => c.kind);
    expect(kinds).toEqual(['alternate']);
  });

  it('a swap inside a prescribed circuit is a swap too', () => {
    const steps = plain.map((s) =>
      s.id === 's8' && s.tool.kind === 'circuit'
        ? { ...s, tool: { ...s.tool, exercises: s.tool.exercises.map((e, i) => (i === 1 ? { ...e, name: 'Bird dog', swapped_from: 'Dead bug' } : e)) } }
        : s,
    );
    expect(structureDiff(steps, defaultShape(steps))).toEqual([
      { kind: 'swap', key: 'swap:s8:1', words: 'Dead bug → bird dog', sentence: 'bird dog instead of dead bug' },
    ]);
  });
});

describe('appendHowTo — one sentence, bounded, never twice', () => {
  it.each([
    ['nothing there yet', '', 'alternate bench press and dumbbell row', 'written', 'alternate bench press and dumbbell row'],
    ['null there', null, 'dead hang one set at a time', 'written', 'dead hang one set at a time'],
    [
      'the coach’s own text stands, the sentence follows it',
      'dead hangs, not farmers carries.',
      'alternate bench press and dumbbell row',
      'written',
      'dead hangs, not farmers carries; alternate bench press and dumbbell row',
    ],
    [
      'the same sentence twice is one',
      'alternate bench press and dumbbell row',
      'Alternate bench press and dumbbell row.',
      'present',
      'alternate bench press and dumbbell row',
    ],
    [
      'the same sentence among others is still one',
      'conversational pace; dead hang one set at a time',
      'dead hang  one set at a time',
      'present',
      'conversational pace; dead hang one set at a time',
    ],
    ['an empty sentence writes nothing', 'keep it easy', '   ', 'present', 'keep it easy'],
  ])('%s', (_n, existing, sentence, status, how_to) => {
    expect(appendHowTo(existing, sentence, 600)).toEqual({ status, how_to });
  });

  it('past the bound nothing is written and nothing already there is dropped', () => {
    const existing = 'x'.repeat(590);
    expect(appendHowTo(existing, 'alternate bench press and dumbbell row', 600)).toEqual({ status: 'full', how_to: existing });
  });
});
