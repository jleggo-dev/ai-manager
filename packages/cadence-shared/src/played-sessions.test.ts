/**
 * A session rearranged by the coach (walkthrough v3 Phase 6, R2's agentic path): the item set
 * must be unchanged, every field but the split comes from the original, and the new structure
 * reads as a played shape so the diff speaks the Recap's words.
 */
import { describe, expect, it } from 'vitest';
import type { OccurrenceSession } from './types/occurrence.ts';
import { carryItems, sameItems, shapeOfRearranged } from './played-sessions.ts';
import { structureDiff } from './played-diff.ts';
import { deriveWalkthrough } from './walkthrough.ts';

/** The value the table says is there. */
function must<T>(x: T | null | undefined): T {
  if (x == null) throw new Error('missing');
  return x;
}

const before: OccurrenceSession = {
  blocks: [
    { label: 'Warm-up', items: [{ name: 'Warm-up', duration_min: 6, tool: 'read' }] },
    {
      label: 'Main',
      items: [
        { name: 'Pull-ups', sets: 3, reps: 5 },
        { name: 'Bench press', sets: 3, reps: 8, load: '95 lb', detail: 'Feet flat.' },
        { name: 'Dumbbell row', sets: 3, reps: 10, load: '40 lb' },
        { name: 'Dead hang', sets: 3, duration_min: 0.75, tool: 'timer' },
      ],
    },
    {
      label: 'Abs',
      mode: 'circuit',
      rounds: 3,
      items: [
        { name: 'Plank', duration_min: 0.5 },
        { name: 'Dead bug', reps: 8 },
      ],
    },
  ],
  note: 'Pull, push, carry.',
  generated_at: '2026-11-02T00:00:00.000Z',
  version: 1,
};

/** The coach's answer to "alternate the presses and rows, spread the hangs out". */
const answer: OccurrenceSession = {
  blocks: [
    { label: 'Warm-up', items: [{ name: 'Warm-up' }] },
    { label: 'Hang', items: [{ name: 'Dead hang', sets: 1 }] },
    { label: 'Pull', items: [{ name: 'Pull-ups', sets: 3, reps: 5 }] },
    { label: 'Hang', items: [{ name: 'Dead hang', sets: 1 }] },
    {
      label: 'Push and pull',
      mode: 'circuit',
      rounds: 3,
      items: [
        { name: 'Bench press', sets: 3, reps: 8, load: '100 lb' },
        { name: 'Dumbbell row', sets: 3 },
      ],
    },
    { label: 'Hang', items: [{ name: 'Dead hang', sets: 1 }] },
    { label: 'Abs', mode: 'circuit', rounds: 3, items: [{ name: 'Plank' }, { name: 'Dead bug' }] },
  ],
  note: 'Presses and rows alternate; the hangs are spread through the session.',
  generated_at: 'x',
  version: 9,
};

describe('sameItems', () => {
  it.each([
    ['the same session', before, true],
    ['the owner’s rearrangement', answer, true],
    ['a move dropped', { blocks: [{ label: 'Main', items: [{ name: 'Pull-ups', sets: 3 }] }] }, false],
    ['a move added', { blocks: [...before.blocks, { label: 'Extra', items: [{ name: 'Burpees', sets: 2 }] }] }, false],
    [
      'a move renamed',
      {
        blocks: [
          {
            label: 'Main',
            items: must(before.blocks[1]).items.map((i) => (i.name === 'Dead hang' ? { ...i, name: 'Dead hangs' } : i)),
          },
          must(before.blocks[0]),
          must(before.blocks[2]),
        ],
      },
      false,
    ],
    [
      'a set lost in the spreading',
      { blocks: answer.blocks.filter((b, i) => !(b.label === 'Hang' && i === 5)) },
      false,
    ],
    [
      'the same names, differently cased and spaced',
      {
        blocks: [
          {
            label: 'x',
            items: before.blocks.flatMap((b) => b.items).map((i) => ({ ...i, name: `  ${i.name.toUpperCase()} ` })),
          },
        ],
      },
      true,
    ],
  ])('%s', (_n, after, expected) => {
    expect(sameItems(before, after)).toBe(expected);
  });
});

describe('carryItems — only the split is the coach’s', () => {
  it('every field comes from the original; sets from the answer; labels, modes and rounds from the answer', () => {
    const carried = must(carryItems(before, answer));
    const main = must(carried.blocks[4]);
    expect(main).toMatchObject({ label: 'Push and pull', mode: 'circuit', rounds: 3 });
    // The answer said 100 lb; the original's 95 lb and cue stand.
    expect(main.items[0]).toEqual({ name: 'Bench press', sets: 3, reps: 8, load: '95 lb', detail: 'Feet flat.' });
    expect(main.items[1]).toEqual({ name: 'Dumbbell row', sets: 3, reps: 10, load: '40 lb' });
    expect(must(carried.blocks[1]).items[0]).toEqual({ name: 'Dead hang', sets: 1, duration_min: 0.75, tool: 'timer' });
    expect(carried.note).toBe(answer.note);
    expect(carried.generated_at).toBe(before.generated_at);
    expect(carried.version).toBe(1);
  });

  it('an item not in the original, or more sets than it had, is null', () => {
    expect(carryItems(before, { blocks: [{ label: 'x', items: [{ name: 'Burpees' }] }], note: '' })).toBeNull();
    expect(
      carryItems(before, { blocks: [{ label: 'x', items: [{ name: 'Dead hang', sets: 4 }] }], note: '' }),
    ).toBeNull();
  });
});

describe('shapeOfRearranged — the new structure in the Recap’s words', () => {
  it('the owner’s rearrangement reads as alternating presses and rows, hangs one at a time', () => {
    const carried = must(carryItems(before, answer));
    const shape = must(shapeOfRearranged(before, carried));
    expect(shape?.map((g) => g.turns.map((t) => `${t.stepId}:${t.set}`).join(' '))).toEqual([
      's1:0',
      's5:0',
      's2:0 s2:1 s2:2',
      's5:1',
      's3:0 s4:0 s3:1 s4:1 s3:2 s4:2',
      's5:2',
      's6:0',
    ]);
    expect(structureDiff(deriveWalkthrough(before).steps, shape).map((c) => c.words)).toEqual([
      'Dead hang, one set at a time',
      'Bench press + dumbbell row, alternating',
    ]);
  });

  it('the same session back is the default shape, with nothing to say', () => {
    const shape = must(shapeOfRearranged(before, before));
    expect(structureDiff(deriveWalkthrough(before).steps, shape)).toEqual([]);
  });

  it('a different item set is null', () => {
    expect(shapeOfRearranged(before, { ...before, blocks: before.blocks.slice(1) })).toBeNull();
  });
});
