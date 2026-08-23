/**
 * The day's foods, flattened — brief 04's view model.
 *
 * The rule that carries the most weight here is the smallest: a missing number renders "—", never
 * 0. A zero is a claim about the FOOD ("this has no fat"); a blank is a statement about US ("we
 * don't hold numbers for this"). The diary is full of hand-typed meals that matched nothing, so
 * the difference is the common case, not the edge one.
 */
import { describe, it, expect } from 'vitest';
import { amountText, cell, diaryRows } from './foodDiaryRows.ts';
import type { Meal } from '../../lib/api.ts';

const meal = (over: Partial<Meal>): Meal => ({ log_id: 'm1', meal: 'lunch', items: [], macros: null, ...over }) as Meal;

describe('diaryRows', () => {
  it('gives every item its own row, addressed for correction', () => {
    const rows = diaryRows([
      meal({
        log_id: 'm1',
        items: [
          { name: 'seasoned peanuts', brand: 'couchetard or K.', qty: 35.5, unit: 'g', est: { kcal: 210 } },
          { name: 'dill pickles', est: { kcal: 5 } },
        ],
      }),
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ logId: 'm1', index: 0, name: 'seasoned peanuts', amount: '35.5 g' });
    expect(rows[1]).toMatchObject({ logId: 'm1', index: 1, name: 'dill pickles' });
  });

  it('keeps a meal that was never broken down as one row that owns the whole meal', () => {
    // index null — there is no addressable item, so it can be read but not repaired.
    const rows = diaryRows([meal({ items: [], raw_text: 'leftover curry', macros: { kcal: 600 } })]);
    expect(rows).toEqual([expect.objectContaining({ index: null, name: 'leftover curry', macros: { kcal: 600 } })]);
  });

  it('surfaces the vendor, which nothing else on any screen has ever shown', () => {
    const rows = diaryRows([meal({ items: [{ name: 'peanuts', brand: 'couchetard or K.' }] })]);
    expect(rows[0]!.brand).toBe('couchetard or K.');
  });
});

describe('amountText', () => {
  it('says what they said', () => {
    expect(amountText(35.5, 'g')).toBe('35.5 g');
    expect(amountText(2, undefined)).toBe('2');
    expect(amountText(undefined, 'cup')).toBe('cup');
  });
  it('has nothing to say when nothing was said', () => {
    expect(amountText(undefined, undefined)).toBeNull();
  });
});

describe('cell', () => {
  it('is null — not zero — when we hold no number', () => {
    expect(cell({ kcal: 210 }, 'fat_g')).toBeNull();
    expect(cell(null, 'kcal')).toBeNull();
  });
  it('keeps a real zero, which is a fact about the food', () => {
    expect(cell({ fat_g: 0 }, 'fat_g')).toBe(0);
  });
  it('rounds — a diary is not a lab notebook', () => {
    expect(cell({ protein_g: 24.6 }, 'protein_g')).toBe(25);
  });
});
