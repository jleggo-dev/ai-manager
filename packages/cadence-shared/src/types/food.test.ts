import { describe, it, expect } from 'vitest';
import { macrosForLog, resolveDefaultServing, scaleNutrients, servingFactor, type Food } from './food.ts';

/** Fage-style yogurt: macros per 100g; servings include 170g container + 100g. */
function yogurt(): Pick<Food, 'base_unit' | 'macros_per_base' | 'servings' | 'default_serving'> {
  return {
    base_unit: 'g',
    macros_per_base: { kcal: 59, protein_g: 10.3, carbs_g: 3.5, fat_g: 0 },
    servings: [
      { label: '1 container (170g)', unit: 'container', amount_g: 170 },
      { label: '100 g', unit: 'g', amount_g: 100 },
    ],
    default_serving: 0,
  };
}

describe('servingFactor', () => {
  it('scales g/ml as amount/100 × quantity (MFP Serving Size × Number of Servings)', () => {
    expect(servingFactor('g', { amount_g: 170 }, 1)).toBeCloseTo(1.7);
    expect(servingFactor('g', { amount_g: 100 }, 1)).toBe(1);
    expect(servingFactor('ml', { amount_g: 250 }, 2)).toBe(5);
  });

  it('scales item as count × quantity', () => {
    expect(servingFactor('item', { amount_g: 1 }, 3)).toBe(3);
    expect(servingFactor('item', { amount_g: 12 }, 1)).toBe(12);
  });

  it('treats non-positive quantity as zero', () => {
    expect(servingFactor('g', { amount_g: 100 }, 0)).toBe(0);
    expect(servingFactor('g', { amount_g: 100 }, -1)).toBe(0);
  });
});

describe('macrosForLog', () => {
  it('computes one container of yogurt from per-100g macros', () => {
    const m = macrosForLog(yogurt());
    expect(m.kcal).toBeCloseTo(100.3, 1);
    expect(m.protein_g).toBeCloseTo(17.5, 1);
    expect(m.carbs_g).toBeCloseTo(6.0, 1);
    expect(m.fat_g).toBe(0);
  });

  it('uses an explicit serving index + quantity multiplier', () => {
    const m = macrosForLog(yogurt(), { servingIndex: 1, quantity: 2 });
    expect(m.kcal).toBeCloseTo(118, 1);
    expect(m.protein_g).toBeCloseTo(20.6, 1);
  });

  it('returns {} when servings are empty', () => {
    expect(macrosForLog({ ...yogurt(), servings: [] })).toEqual({});
  });

  it('falls back to index 0 when default_serving is out of range', () => {
    const m = macrosForLog({ ...yogurt(), default_serving: 99 });
    expect(m.kcal).toBeCloseTo(100.3, 1);
  });

  it('scales item-base foods by count', () => {
    const egg: Pick<Food, 'base_unit' | 'macros_per_base' | 'servings' | 'default_serving'> = {
      base_unit: 'item',
      macros_per_base: { kcal: 72, protein_g: 6.3, carbs_g: 0.4, fat_g: 4.8 },
      servings: [
        { label: '1 large egg', unit: 'egg', amount_g: 1 },
        { label: '1 dozen', unit: 'dozen', amount_g: 12 },
      ],
      default_serving: 0,
    };
    expect(macrosForLog(egg, { quantity: 3 }).kcal).toBeCloseTo(216, 1);
    expect(macrosForLog(egg, { servingIndex: 1 }).protein_g).toBeCloseTo(75.6, 1);
  });
});

describe('scaleNutrients / resolveDefaultServing', () => {
  it('scales only finite numeric nutrient keys', () => {
    expect(scaleNutrients({ kcal: 100, protein_g: 10, fiber_g: undefined }, 1.5)).toEqual({
      kcal: 150,
      protein_g: 15,
    });
  });

  it('resolves the default serving row', () => {
    const food = yogurt();
    expect(resolveDefaultServing(food)?.label).toBe('1 container (170g)');
    expect(resolveDefaultServing({ ...food, default_serving: 1 })?.unit).toBe('g');
    expect(resolveDefaultServing({ ...food, servings: [] })).toBeNull();
  });
});
