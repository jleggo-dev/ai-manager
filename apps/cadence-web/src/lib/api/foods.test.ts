/**
 * The recents/search wire shape, where a row earns its one-tap ＋.
 *
 * `GET /nutrition/foods/recents` hands back whole `Food` rows plus the user's `use_count`. If the
 * calories cannot be derived from those fields the row silently loses its ＋ and falls back to the
 * amount sheet — the exact friction this feature exists to remove — so the contract is pinned here
 * rather than left to the screen tests, which mock this layer away.
 */
import { describe, it, expect } from 'vitest';
import { parseFoodList } from './foods.ts';

const latte = {
  food_id: 'f9',
  name: 'Starbucks latte',
  brand: null,
  base_unit: 'item',
  macros_per_base: { kcal: 250, protein_g: 13 },
  servings: [{ label: 'venti', unit: 'venti', amount_g: 1 }],
  default_serving: 0,
  use_count: 2,
};

describe('parseFoodList', () => {
  it('derives what one tap adds, and how often it has been logged', () => {
    expect(parseFoodList({ foods: [latte] })).toEqual([
      { food_id: 'f9', name: 'Starbucks latte', brand: null, serving_label: 'venti', kcal: 250, count: 2 },
    ]);
  });

  it('honours the food default_serving rather than assuming the first', () => {
    const [row] = parseFoodList({
      foods: [
        {
          ...latte,
          base_unit: 'g',
          macros_per_base: { kcal: 100 },
          servings: [
            { label: '100 g', unit: 'g', amount_g: 100 },
            { label: '250 g', unit: 'g', amount_g: 250 },
          ],
          default_serving: 1,
        },
      ],
    });
    expect(row?.serving_label).toBe('250 g');
    expect(row?.kcal).toBe(250);
  });

  it('reports no calories rather than a zero when the food carries none', () => {
    const [row] = parseFoodList({ foods: [{ ...latte, macros_per_base: {}, use_count: 0 }] });
    expect(row?.kcal).toBeNull();
    expect(row?.count).toBeNull();
  });

  it('survives a bare array and rows missing the food fields', () => {
    expect(parseFoodList([{ food_id: 'f1', name: 'Toast' }])).toEqual([
      { food_id: 'f1', name: 'Toast', brand: null, serving_label: null, kcal: null, count: null },
    ]);
    expect(parseFoodList({ foods: [{ name: 'no id' }, null, 'nonsense'] })).toEqual([]);
  });
});
