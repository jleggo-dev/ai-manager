/**
 * Pure session-edit helper tests — add/duplicate/delete/reorder/retitle/total, plus the palette's
 * default-step factory and the tool-specific field patchers. No React here; ActivityBuilder.tsx
 * and its cards are wired-button tests instead (StepCard.test.tsx / ActivityBuilder.test.tsx).
 */
import { describe, it, expect } from 'vitest';
import { inferTool } from '@cadence/shared';
import {
  addCard,
  addCircuitExercise,
  addStepOfKind,
  blankSession,
  cardsFromSession,
  defaultBlockFor,
  deleteCard,
  duplicateCard,
  formatStepSummary,
  moveCardDown,
  moveCardUp,
  removeCircuitExercise,
  retitleCard,
  sessionFromCards,
  stepSummary,
  updateCardItem,
  updateCircuitExercise,
  updateCircuitRounds,
  type BuilderCard,
  type PaletteStepKind,
} from './builderSession.ts';

function timerCards(): BuilderCard[] {
  return cardsFromSession({
    blocks: [
      { label: 'Warm-up', items: [{ name: 'Warm-up', tool: 'timer', duration_min: 3 }] },
      { label: 'Main', items: [{ name: 'Main set', tool: 'reps', sets: 3, reps: 8 }] },
    ],
    note: '',
    generated_at: '2026-01-01T00:00:00.000Z',
    version: 1,
  });
}

describe('cardsFromSession / sessionFromCards', () => {
  it('round-trips blocks losslessly, minus the builder-only ids', () => {
    const cards = timerCards();
    expect(cards).toHaveLength(2);
    expect(cards[0]?.id).toBeTruthy();
    const out = sessionFromCards(cards, 'a note');
    expect(out.blocks).toEqual([
      { label: 'Warm-up', items: [{ name: 'Warm-up', tool: 'timer', duration_min: 3 }] },
      { label: 'Main', items: [{ name: 'Main set', tool: 'reps', sets: 3, reps: 8 }] },
    ]);
    expect(out.note).toBe('a note');
  });

  it('cardsFromSession on null/undefined is an empty draft, and blankSession has no blocks', () => {
    expect(cardsFromSession(null)).toEqual([]);
    expect(cardsFromSession(undefined)).toEqual([]);
    expect(blankSession().blocks).toEqual([]);
  });

  it('editing a card never mutates the session it was loaded from', () => {
    const original = {
      blocks: [{ label: 'A', items: [{ name: 'A', tool: 'timer' as const, duration_min: 1 }] }],
      note: '',
      generated_at: '',
      version: 1,
    };
    const cards = cardsFromSession(original);
    updateCardItem(cards, 0, { duration_min: 99 });
    expect(original.blocks[0]?.items[0]?.duration_min).toBe(1);
  });
});

describe('add / duplicate / delete', () => {
  it('addCard appends at the end', () => {
    const cards = addCard([], { label: 'X', items: [{ name: 'X', tool: 'timer', duration_min: 1 }] });
    expect(cards).toHaveLength(1);
    expect(cards[0]?.block.label).toBe('X');
  });

  it('duplicateCard deep-copies the card and lands it immediately after the original', () => {
    const cards = timerCards();
    const next = duplicateCard(cards, 0);
    expect(next).toHaveLength(3);
    expect(next[0]?.block.items[0]?.name).toBe('Warm-up');
    expect(next[1]?.block.items[0]?.name).toBe('Warm-up');
    expect(next[1]?.id).not.toBe(next[0]?.id);
    // A deep copy, not a shared reference — editing the duplicate must not touch the original.
    const edited = updateCardItem(next, 1, { duration_min: 40 });
    expect(edited[0]?.block.items[0]?.duration_min).toBe(3);
    expect(edited[1]?.block.items[0]?.duration_min).toBe(40);
  });

  it('duplicateCard on an out-of-range index is a no-op', () => {
    const cards = timerCards();
    expect(duplicateCard(cards, 9)).toBe(cards);
  });

  it('deleteCard removes exactly the one card', () => {
    const cards = timerCards();
    const next = deleteCard(cards, 0);
    expect(next).toHaveLength(1);
    expect(next[0]?.block.items[0]?.name).toBe('Main set');
  });

  it('deleteCard out of range is a no-op', () => {
    const cards = timerCards();
    expect(deleteCard(cards, -1)).toBe(cards);
    expect(deleteCard(cards, 5)).toBe(cards);
  });
});

describe('reorder (up/down, never a pointer-drag)', () => {
  it('moveCardDown then moveCardUp is the identity', () => {
    const cards = timerCards();
    const names = (cs: BuilderCard[]) => cs.map((c) => c.block.items[0]?.name);
    const down = moveCardDown(cards, 0);
    expect(names(down)).toEqual(['Main set', 'Warm-up']);
    const back = moveCardUp(down, 1);
    expect(names(back)).toEqual(['Warm-up', 'Main set']);
  });

  it('moveCardUp at the top and moveCardDown at the bottom are no-ops', () => {
    const cards = timerCards();
    expect(moveCardUp(cards, 0)).toBe(cards);
    expect(moveCardDown(cards, 1)).toBe(cards);
  });
});

describe('retitleCard', () => {
  it('renames a straight card on both the item and the block label', () => {
    const cards = timerCards();
    const next = retitleCard(cards, 0, 'Get moving');
    expect(next[0]?.block.items[0]?.name).toBe('Get moving');
    expect(next[0]?.block.label).toBe('Get moving');
  });

  it('renames a circuit card on the block label only (no single item to name)', () => {
    const cards = addCard([], defaultBlockFor('circuit'));
    const next = retitleCard(cards, 0, 'Leg day');
    expect(next[0]?.block.label).toBe('Leg day');
    expect(next[0]?.block.items[0]?.name).toBe('Exercise A');
  });
});

describe('tool-specific field edits', () => {
  it('updateCardItem patches the one item on a straight card', () => {
    const cards = timerCards();
    const next = updateCardItem(cards, 0, { duration_min: 12 });
    expect(next[0]?.block.items[0]?.duration_min).toBe(12);
  });

  it('updateCardItem on a circuit card is a no-op — no single item to patch', () => {
    const cards = addCard([], defaultBlockFor('circuit'));
    expect(updateCardItem(cards, 0, { duration_min: 5 })).toBe(cards);
  });

  it('updateCircuitRounds sets rounds, floored at 1', () => {
    const cards = addCard([], defaultBlockFor('circuit'));
    const next = updateCircuitRounds(cards, 0, 5);
    expect(next[0]?.block.rounds).toBe(5);
    expect(updateCircuitRounds(cards, 0, 0)[0]?.block.rounds).toBe(1);
  });

  it('updateCircuitExercise patches one exercise by index', () => {
    const cards = addCard([], defaultBlockFor('circuit'));
    const next = updateCircuitExercise(cards, 0, 1, { name: 'Lunges', reps: 20 });
    expect(next[0]?.block.items[1]).toEqual({ name: 'Lunges', reps: 20 });
    expect(next[0]?.block.items[0]?.name).toBe('Exercise A');
  });

  it('addCircuitExercise appends a lettered placeholder; removeCircuitExercise keeps at least one', () => {
    const cards = addCard([], defaultBlockFor('circuit'));
    const withThird = addCircuitExercise(cards, 0);
    expect(withThird[0]?.block.items).toHaveLength(3);
    expect(withThird[0]?.block.items[2]?.name).toBe('Exercise C');

    const downToOne = removeCircuitExercise(removeCircuitExercise(withThird, 0, 0), 0, 0);
    expect(downToOne[0]?.block.items).toHaveLength(1);
    // Refuses to go to zero exercises — a circuit with nothing to rotate isn't a circuit.
    expect(removeCircuitExercise(downToOne, 0, 0)).toBe(downToOne);
  });
});

describe('defaultBlockFor + addStepOfKind — every palette kind resolves to its own tool', () => {
  const kinds: PaletteStepKind[] = [
    'timer',
    'interval',
    'reps',
    'circuit',
    'breathing',
    'meditate',
    'grounding',
    'checkoff',
    'read',
    'journal',
    'feeling_log',
    'measure',
  ];

  it.each(kinds)('%s inserts a step whose tool resolves to itself', (kind) => {
    const cards = addStepOfKind([], kind);
    expect(cards).toHaveLength(1);
    const block = cards[0]?.block;
    if (kind === 'circuit') {
      expect(block?.mode).toBe('circuit');
      return;
    }
    const item = block?.items[0];
    expect(item).toBeTruthy();
    expect(inferTool(item!).kind).toBe(kind);
  });
});

describe('stepSummary / formatStepSummary — honest, never invented', () => {
  it('an empty draft reads as empty, not a zero total', () => {
    expect(formatStepSummary([])).toBe('Add a step to begin.');
    expect(stepSummary([]).counts).toEqual([]);
  });

  it('tallies real buckets and a total sourced from deriveWalkthrough, in order', () => {
    let cards = addStepOfKind([], 'read'); // cue
    cards = addStepOfKind(cards, 'timer'); // timed
    cards = addStepOfKind(cards, 'interval'); // timed
    cards = addStepOfKind(cards, 'journal'); // write
    const summary = stepSummary(cards);
    expect(summary.counts).toEqual([
      { bucket: 'cue', count: 1 },
      { bucket: 'timed', count: 2 },
      { bucket: 'write', count: 1 },
    ]);
    expect(summary.totalMin).toBeGreaterThan(0);
    expect(formatStepSummary(cards)).toBe(`1 cue · 2 timed · 1 write · Total ~${summary.totalMin} min`);
  });

  it('a circuit card counts as one "set" step, matching what the player actually shows', () => {
    const cards = addStepOfKind([], 'circuit');
    expect(stepSummary(cards).counts).toEqual([{ bucket: 'set', count: 1 }]);
  });
});
