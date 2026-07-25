import { describe, it, expect } from 'vitest';
import type { Food } from '@cadence/shared';
import {
  computeMacrosPerServing,
  macrosForIngredientAmount,
  scaleMacros,
  sumMacros,
  toMacros,
} from './recipe-macros.ts';

function beef(): Pick<Food, 'base_unit' | 'macros_per_base' | 'servings' | 'default_serving'> {
  return {
    base_unit: 'g',
    macros_per_base: { kcal: 250, protein_g: 26, carbs_g: 0, fat_g: 17 },
    servings: [
      { label: '100 g', unit: 'g', amount_g: 100 },
      { label: '1 oz', unit: 'oz', amount_g: 28 },
    ],
    default_serving: 0,
  };
}

function beans(): Pick<Food, 'base_unit' | 'macros_per_base' | 'servings' | 'default_serving'> {
  return {
    base_unit: 'g',
    macros_per_base: { kcal: 90, protein_g: 6, carbs_g: 15, fat_g: 0.5 },
    servings: [{ label: '1 can (400g)', unit: 'can', amount_g: 400 }],
    default_serving: 0,
  };
}

describe('macrosForIngredientAmount', () => {
  it('scales grams against macros_per_base (per 100g)', () => {
    const m = macrosForIngredientAmount(beef(), 500, 'g');
    expect(m.kcal).toBeCloseTo(1250, 0);
    expect(m.protein_g).toBeCloseTo(130, 0);
  });

  it('matches named serving units (can × qty)', () => {
    const m = macrosForIngredientAmount(beans(), 2, 'can');
    // 400g × 2 / 100 × 90 kcal = 720
    expect(m.kcal).toBeCloseTo(720, 0);
    expect(m.protein_g).toBeCloseTo(48, 0);
  });

  it('falls back to default serving × qty when unit unknown', () => {
    const m = macrosForIngredientAmount(beans(), 1, 'bowl');
    expect(m.kcal).toBeCloseTo(360, 0);
  });
});

describe('computeMacrosPerServing', () => {
  it('divides the batch total by servings (chili-style)', () => {
    const beefM = toMacros(macrosForIngredientAmount(beef(), 500, 'g'));
    const beansM = toMacros(macrosForIngredientAmount(beans(), 2, 'can'));
    const per = computeMacrosPerServing([beefM, beansM], 6);
    // (1250 + 720) / 6 = 328.33
    expect(per.kcal).toBeCloseTo(328.3, 0);
    expect(per.protein_g).toBeCloseTo(29.7, 0);
    expect(per.source).toBe('ai');
  });

  it('returns empty macros when servings invalid', () => {
    expect(computeMacrosPerServing([{ kcal: 100 }], 0)).toEqual({ source: 'ai' });
  });
});

describe('sumMacros / scaleMacros', () => {
  it('sums and scales for logging N servings', () => {
    const total = sumMacros([
      { kcal: 100, protein_g: 10 },
      { kcal: 50, protein_g: 5 },
    ]);
    expect(total.kcal).toBe(150);
    expect(scaleMacros(total, 2).kcal).toBe(300);
  });
});
