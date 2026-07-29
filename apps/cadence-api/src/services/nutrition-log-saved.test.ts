import { describe, it, expect } from 'vitest';
import { macrosForLog } from '@cadence/shared';
import { composePlate, type PlateFood } from './plate-compose.ts';

function food(id: string, name: string): PlateFood {
  return {
    food_id: id,
    name,
    base_unit: 'g',
    macros_per_base: { kcal: 2, protein_g: 0.1, carbs_g: 0.2, fat_g: 0.05 },
    servings: [
      { label: 'bowl', unit: 'bowl', amount_g: 100 },
      { label: 'half', unit: 'bowl', amount_g: 50 },
    ],
    default_serving: 0,
  };
}

describe('composePlate', () => {
  it('folds N items into one meal with summed macros + per-item est', () => {
    const a = food('a', 'Chili');
    const b = food('b', 'Rice');
    const { items, macros } = composePlate(
      [a, b],
      [
        { serving_index: 0, quantity: 1.5 },
        { serving_index: 1, quantity: 1 },
      ],
    );

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ name: 'Chili', qty: 1.5, unit: 'bowl', food_id: 'a' });
    expect(items[1]).toMatchObject({ name: 'Rice', qty: 1, food_id: 'b' });

    const m0 = macrosForLog(a, { servingIndex: 0, quantity: 1.5 });
    const m1 = macrosForLog(b, { servingIndex: 1, quantity: 1 });
    expect(items[0]?.est?.kcal).toBe(m0.kcal);
    expect(macros?.kcal).toBe(Math.round((m0.kcal ?? 0) + (m1.kcal ?? 0)));
    expect(macros?.protein_g).toBeCloseTo(Math.round(((m0.protein_g ?? 0) + (m1.protein_g ?? 0)) * 10) / 10);
  });

  it('defaults a bad serving index to the food default and a bad quantity to 1', () => {
    const a = food('a', 'Chili');
    const { items, macros } = composePlate([a], [{ serving_index: 99, quantity: -3 }]);
    expect(items[0]?.qty).toBe(1);
    const def = macrosForLog(a, { servingIndex: 0, quantity: 1 });
    expect(macros?.kcal).toBe(Math.round(def.kcal ?? 0));
  });

  it('returns null macros when the plate carries no nutrients', () => {
    const water: PlateFood = {
      food_id: 'x',
      name: 'Water',
      base_unit: 'g',
      macros_per_base: {},
      servings: [{ label: 'glass', unit: 'glass', amount_g: 250 }],
      default_serving: 0,
    };
    const { items, macros } = composePlate([water], [{}]);
    expect(items).toHaveLength(1);
    expect(macros).toBeNull();
  });
});
