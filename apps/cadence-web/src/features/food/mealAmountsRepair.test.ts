/**
 * The pre-log repairs, at the state level — brief 03.
 *
 * Same semantics as the server-side corrections (`meal-corrections.ts`), deliberately: the confirm
 * card and the logged-meal sheet are one surface shown at two times, and a merge that behaved
 * differently depending on WHEN you noticed would be the app contradicting itself.
 */
import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useMealAmounts } from './useMealAmounts.ts';
import type { MealPreview } from '../../lib/api.ts';

const preview = {
  raw_text: 'These are dill pickles, seasoned peanuts from couchetard or K. The pack is 71 g.',
  items: [
    {
      name: 'seasoned peanuts',
      brand: 'couchetard or K.',
      qty: 35.5,
      unit: 'g',
      est: { kcal: 210, protein_g: 9, fat_g: 18, sodium_mg: 225 },
    },
    { name: 'dill pickles', qty: 1, unit: 'serving', est: { kcal: 5, sodium_mg: 450 } },
  ],
} as unknown as MealPreview;

describe('renameRow', () => {
  it('fixes the label and keeps every number', () => {
    const { result } = renderHook(() => useMealAmounts(preview));
    act(() => result.current.renameRow(0, 'Dill Pickle Peanuts', 'Couche-Tard'));
    expect(result.current.rows[0]).toMatchObject({
      name: 'Dill Pickle Peanuts',
      brand: 'Couche-Tard',
      est: { kcal: 210, protein_g: 9, fat_g: 18, sodium_mg: 225 },
      qty: 35.5,
    });
  });

  it('refuses a blank name and leaves an untouched vendor alone', () => {
    const { result } = renderHook(() => useMealAmounts(preview));
    act(() => result.current.renameRow(0, '   '));
    expect(result.current.rows[0]!.name).toBe('seasoned peanuts');
    act(() => result.current.renameRow(0, 'Peanuts'));
    expect(result.current.rows[0]!.brand).toBe('couchetard or K.');
  });
});

describe('mergeRow', () => {
  it('folds the nutrients in and takes the phantom row off', () => {
    // 675 mg as parsed; 225 mg as actually eaten. Deleting the row while keeping the meal total
    // is exactly how sodium that was never eaten stays on the day.
    const { result } = renderHook(() => useMealAmounts(preview));
    expect(result.current.total.sodium_mg).toBe(675);
    act(() => result.current.mergeRow(1, 0));
    expect(result.current.rows).toHaveLength(1);
    expect(result.current.rows[0]).toMatchObject({ name: 'seasoned peanuts', est: { kcal: 215, sodium_mg: 675 } });
  });

  it('does not sum the amount — two rows of one food are one portion read twice', () => {
    const { result } = renderHook(() => useMealAmounts(preview));
    act(() => result.current.mergeRow(1, 0));
    expect(result.current.rows[0]!.qty).toBe(35.5);
  });

  it('is a no-op on itself or a row that is not there', () => {
    const { result } = renderHook(() => useMealAmounts(preview));
    act(() => result.current.mergeRow(0, 0));
    act(() => result.current.mergeRow(9, 0));
    expect(result.current.rows).toHaveLength(2);
  });
});

/**
 * The coach's link (`food_id`) and their words (`said`) ride back on the confirm so the server
 * prices from the food and the phrase memory learns — until a repair makes the row a new reading.
 */
describe('a linked row through the repairs', () => {
  const linked = {
    raw_text: 'Starbucks venti latte and a banana',
    items: [
      {
        name: 'Caffè Latte (Venti)',
        brand: 'Starbucks',
        qty: 1,
        unit: 'venti',
        est: { kcal: 250, protein_g: 16 },
        food_id: 'f-latte',
        said: 'Starbucks venti latte',
      },
      {
        name: 'Banana, raw',
        qty: 1,
        unit: 'medium',
        est: { kcal: 105, protein_g: 1 },
        food_id: 'f-banana',
        said: 'a banana',
      },
    ],
  } as unknown as MealPreview;

  it('toPreview carries food_id and said for every linked row', () => {
    const { result } = renderHook(() => useMealAmounts(linked));
    const sent = result.current.toPreview().items;
    expect(sent[0]).toMatchObject({ food_id: 'f-latte', said: 'Starbucks venti latte', qty: 1, unit: 'venti' });
    expect(sent[1]).toMatchObject({ food_id: 'f-banana', said: 'a banana' });
  });

  it('a rename keeps the link and the words — fix the name, keep the numbers (brief 03)', () => {
    const { result } = renderHook(() => useMealAmounts(linked));
    act(() => result.current.renameRow(0, 'Latte', 'Starbucks'));
    expect(result.current.toPreview().items[0]).toMatchObject({
      name: 'Latte',
      food_id: 'f-latte',
      said: 'Starbucks venti latte',
    });
  });

  it('a merge drops the link and the words: the sum is no single food, and nothing is taught from it', () => {
    const { result } = renderHook(() => useMealAmounts(linked));
    act(() => result.current.mergeRow(1, 0));
    expect(result.current.rows).toHaveLength(1);
    expect(result.current.rows[0]).toMatchObject({ name: 'Caffè Latte (Venti)', matched: false, est: { kcal: 355 } });
    const sent = result.current.toPreview().items[0]!;
    expect(sent.food_id).toBeUndefined();
    expect(sent.said).toBeUndefined();
    expect(sent.est?.kcal).toBe(355);
  });

  it('near-miss: a row that never had a link sends none, before or after a rename', () => {
    const { result } = renderHook(() => useMealAmounts(preview));
    act(() => result.current.renameRow(1, 'Pickles'));
    expect(result.current.toPreview().items[1]).toEqual({
      name: 'Pickles',
      qty: 1,
      unit: 'serving',
      est: { kcal: 5, sodium_mg: 450 },
    });
  });
});
