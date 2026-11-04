/**
 * What a group row says (walkthrough v3 Phase 6): the pills per shape, the title and meta, the
 * toast — a router from shape to words, so a table of shapes and the near-misses.
 */
import { describe, expect, it } from 'vitest';
import { type WalkthroughStep, combine, defaultShape, moveTurnOut } from '@cadence/shared';
import { combineToast, groupPills, groupWords } from './rearrange-words.ts';
import { gapForY } from './useRearrangeDrag.ts';

const steps: WalkthroughStep[] = [
  { id: 's1', title: 'Warm-up', minutes: 6, tool: { kind: 'read' }, skippable: true },
  { id: 's2', title: 'Pull-ups', minutes: 6, tool: { kind: 'reps', sets: 3, reps: 5 }, skippable: true },
  { id: 's3', title: 'Bench press', minutes: 9, tool: { kind: 'reps', sets: 3, reps: 8, load: '95 lb' }, skippable: true },
  { id: 's4', title: 'Dumbbell row', minutes: 9, tool: { kind: 'reps', sets: 3, reps: 10 }, skippable: true },
  { id: 's5', title: 'Dead hang', minutes: 3, tool: { kind: 'timer', seconds: 45, sets: 3 }, skippable: true },
  { id: 's6', title: 'Abs circuit', minutes: 8, tool: { kind: 'circuit', rounds: 3, exercises: [{ name: 'Plank', seconds: 30 }, { name: 'Dead bug', reps: 8 }, { name: 'Side plank', seconds: 20 }, { name: 'Hollow hold', seconds: 20 }] }, skippable: true },
];
const stepOf = (id: string) => steps.find((s) => s.id === id);
const base = defaultShape(steps);
const at = (i: number) => base[i]!;

describe('groupWords and groupPills — what a row draws', () => {
  it.each([
    ['a read', at(0), 'Warm-up', '1 set', ['6 min']],
    ['reps', at(1), 'Pull-ups', '3 sets', ['Pull-up 5', 'Pull-up 5', 'Pull-up 5']],
    ['timed sets', at(4), 'Dead hang', '3 sets', ['Hang 45 s', 'Hang 45 s', 'Hang 45 s']],
    ['a prescribed circuit', at(5), 'Abs circuit', '3 rounds', ['4 moves × 3 rounds']],
    [
      'two moves alternating',
      combine(base, 'g3', 'g4', 'alternate')[2]!,
      'Bench press + dumbbell row',
      '6 sets',
      ['Bench', 'Row', 'Bench', 'Row', 'Bench', 'Row'],
    ],
    ['one set dragged out', moveTurnOut(base, 'g5', 0, 1)[1]!, 'Dead hang', '1 set', ['Hang 45 s']],
    ['the two left behind', moveTurnOut(base, 'g5', 0, 1)[5]!, 'Dead hang', '2 sets', ['Hang 45 s', 'Hang 45 s']],
  ])('%s', (_n, group, title, meta, pills) => {
    expect(groupWords(group, stepOf)).toEqual({ title, meta });
    expect(groupPills(group, stepOf).map((p) => p.label)).toEqual(pills);
  });

  it('a combined group marks the second move’s pills, and a timed set its pills', () => {
    const pair = groupPills(combine(base, 'g3', 'g4', 'alternate')[2]!, stepOf);
    expect(pair.map((p) => p.alt)).toEqual([false, true, false, true, false, true]);
    expect(groupPills(at(4), stepOf).every((p) => p.timed)).toBe(true);
    expect(groupPills(at(1), stepOf).every((p) => !p.timed && !p.alt)).toBe(true);
  });
});

describe('combineToast', () => {
  it.each([
    [['Farmer carry', 'Hip thrust'], 'alternate', 'Farmer carry and hip thrust now alternate.'],
    [['Bench press', 'Dumbbell row'], 'sequence', 'Bench press and dumbbell row now run in sequence.'],
    [['Pull-ups', 'Bench press', 'Dumbbell row'], 'alternate', 'Pull-ups and bench press and dumbbell row now alternate.'],
  ] as const)('%s', (titles, mode, expected) => {
    expect(combineToast(titles, mode)).toBe(expected);
  });
});

describe('gapForY — which gap the finger is over', () => {
  const rows = [
    { top: 0, bottom: 60 },
    { top: 68, bottom: 128 },
    { top: 136, bottom: 196 },
  ];
  it.each([
    ['above the first row’s middle', 10, 0],
    ['just under the first row’s middle', 40, 1],
    ['between the first and second', 64, 1],
    ['the second row’s lower half', 110, 2],
    ['below the last row’s middle', 180, 3],
    ['far below', 900, 3],
    ['no rows at all', 50, 0],
  ])('%s', (_n, y, gap) => {
    expect(gapForY(y === 50 && gap === 0 ? [] : rows, y)).toBe(gap);
  });
});
