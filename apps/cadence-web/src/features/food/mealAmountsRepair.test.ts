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
