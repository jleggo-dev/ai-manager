import { describe, expect, it } from 'vitest';
import { PREVIOUS_ROW_MAX_CHARS, PREVIOUS_ROWS_MAX } from '@cadence/shared';
import { previousRows } from './previousRows.ts';

describe('previousRows — the card as lines a correction carries back', () => {
  it('names each row with its amount, a brand in front, a question row as waiting', () => {
    expect(
      previousRows([
        { name: 'Guinness (Can)', brand: 'Red Robin', qty: 1, unit: 'serving' },
        { name: 'Fried Chicken Wing No Coating', qty: 453.6, unit: 'g' },
        { name: 'milk', question: 'Whole milk or 2%?' },
      ]),
    ).toEqual([
      'Red Robin Guinness (Can), 1 serving',
      'Fried Chicken Wing No Coating, 453.6 g',
      'milk, waiting on: Whole milk or 2%?',
    ]);
  });

  it('stays within the caps the server enforces', () => {
    const many = Array.from({ length: PREVIOUS_ROWS_MAX + 2 }, (_, i) => ({ name: `row ${i}`, qty: 1, unit: 'cup' }));
    expect(previousRows(many)).toHaveLength(PREVIOUS_ROWS_MAX);
    const [long] = previousRows([{ name: 'x'.repeat(PREVIOUS_ROW_MAX_CHARS + 20), qty: 1, unit: 'cup' }]);
    expect(long!.length).toBe(PREVIOUS_ROW_MAX_CHARS);
  });
});
