/**
 * A23 §1a — portion arithmetic for the food ledger. Pure: no DB, no AI, no env.
 *
 * The headline case is the round-trip invariant at the bottom: pinning an estimate and pricing
 * the same portion back out must return the same numbers. That is what makes a pinned food a
 * stable price instead of a second guess.
 */
import { describe, it, expect } from 'vitest';
import type { Food, FoodNutrients } from '@cadence/shared';
import { absoluteAmount, nutrientsPerBase, portionFactor, priceFood } from './food-pricing-portion.ts';

type TestFood = Pick<Food, 'base_unit' | 'macros_per_base' | 'servings' | 'default_serving'>;

/** Greek yogurt: per-100 g nutrients, sold as a 170 g container. */
const YOGURT: TestFood = {
  base_unit: 'g',
  macros_per_base: { kcal: 59, protein_g: 10, calcium_mg: 110 },
  servings: [
    { label: '1 container (170g)', unit: 'container', amount_g: 170 },
    { label: '100 g', unit: 'g', amount_g: 100 },
  ],
  default_serving: 0,
};

/** A countable food: base is one egg. */
const EGG: TestFood = {
  base_unit: 'item',
  macros_per_base: { kcal: 70, protein_g: 6 },
  servings: [{ label: '1 egg', unit: 'egg', amount_g: 1 }],
  default_serving: 0,
};

describe('absoluteAmount', () => {
  it('converts mass and volume units to base units', () => {
    expect(absoluteAmount('g', 170)).toBe(170);
    expect(absoluteAmount('kg', 1.2)).toBeCloseTo(1200, 5);
    expect(absoluteAmount('oz', 2)).toBeCloseTo(56.699, 2);
    expect(absoluteAmount('ml', 250)).toBe(250);
    expect(absoluteAmount('L', 1)).toBe(1000);
  });

  it('leaves serving words alone so the food’s own servings win', () => {
    expect(absoluteAmount('bowl', 1)).toBeNull();
    expect(absoluteAmount('cup', 1)).toBeNull();
    expect(absoluteAmount('container', 1)).toBeNull();
    expect(absoluteAmount('slice', 2)).toBeNull();
  });

  it('needs a positive quantity and a unit', () => {
    expect(absoluteAmount('g', 0)).toBeNull();
    expect(absoluteAmount('g', undefined)).toBeNull();
    expect(absoluteAmount(undefined, 100)).toBeNull();
    expect(absoluteAmount('g', Number.NaN)).toBeNull();
  });
});

describe('portionFactor', () => {
  /**
   * The bug this module exists to prevent: "170 g" against a per-100 g food is 1.7 bases. Read as
   * a serving multiplier it would be 170 × a 170 g container — a 17,000 kcal breakfast.
   */
  it('treats an absolute mass as an amount, never as a serving multiplier', () => {
    const p = portionFactor(YOGURT, { qty: 170, unit: 'g', text: '170 g yogurt' });
    expect(p.factor).toBeCloseTo(1.7, 6);
    expect(p.serving_index).toBeNull();
    expect(priceFood(YOGURT, { qty: 170, unit: 'g' }).kcal).toBeCloseTo(100.3, 1);
  });

  it('agrees with itself whichever way the same portion is described', () => {
    const byMass = priceFood(YOGURT, { qty: 170, unit: 'g' });
    const bySer = priceFood(YOGURT, { qty: 1, unit: 'container' });
    expect(byMass.kcal).toBeCloseTo(bySer.kcal!, 1);
    expect(byMass.protein_g).toBeCloseTo(bySer.protein_g!, 1);
  });

  it('uses servings[] for serving-shaped units', () => {
    const p = portionFactor(YOGURT, { qty: 2, unit: 'container', text: '2 containers of yogurt' });
    expect(p.serving_index).toBe(0);
    expect(p.factor).toBeCloseTo(3.4, 6);
    expect(p.unit).toBe('container');
  });

  it('multiplies countable items by quantity', () => {
    expect(portionFactor(EGG, { qty: 3, text: '3 eggs' }).factor).toBe(3);
    expect(priceFood(EGG, { qty: 3, text: '3 eggs' })).toEqual({ kcal: 210, protein_g: 18 });
  });

  it('falls back to the default serving and quantity 1 when the parse gave nothing', () => {
    const p = portionFactor(YOGURT, {});
    expect(p.serving_index).toBe(0);
    expect(p.quantity).toBe(1);
    expect(p.factor).toBeCloseTo(1.7, 6);
  });

  it('infers quantity from phrasing when qty is absent', () => {
    expect(portionFactor(EGG, { text: 'half an egg' }).quantity).toBe(0.5);
  });

  it('ignores junk quantities rather than zeroing the meal', () => {
    expect(portionFactor(EGG, { qty: -2, text: 'eggs' }).quantity).toBe(1);
    expect(portionFactor(EGG, { qty: Number.NaN, text: 'eggs' }).quantity).toBe(1);
  });

  it('never scales a food that carries no servings', () => {
    const empty: TestFood = { base_unit: 'item', macros_per_base: { kcal: 100 }, servings: [], default_serving: 0 };
    expect(portionFactor(empty, { qty: 2 }).factor).toBe(0);
    expect(priceFood(empty, { qty: 2 })).toEqual({});
  });
});

describe('nutrientsPerBase (pinning a one-off estimate)', () => {
  it('pins an absolute-mass portion per 100 base units', () => {
    const pin = nutrientsPerBase({ kcal: 100, protein_g: 17 }, { qty: 170, unit: 'g' });
    expect(pin?.base_unit).toBe('g');
    expect(pin?.macros_per_base.kcal).toBeCloseTo(58.8, 1);
    // What they actually ate is the default serving, so the next log reproduces it.
    expect(pin?.servings[0]).toEqual({ label: '170 g', unit: 'g', amount_g: 170 });
    expect(pin?.default_serving).toBe(0);
  });

  it('pins a volume portion as ml', () => {
    expect(nutrientsPerBase({ kcal: 120 }, { qty: 500, unit: 'ml' })?.base_unit).toBe('ml');
  });

  it('pins a countable portion as one item, dividing out the quantity', () => {
    const pin = nutrientsPerBase({ kcal: 210, protein_g: 18 }, { qty: 3, unit: 'egg' });
    expect(pin?.base_unit).toBe('item');
    expect(pin?.macros_per_base).toEqual({ kcal: 70, protein_g: 6 });
    expect(pin?.servings).toEqual([{ label: '1 egg', unit: 'egg', amount_g: 1 }]);
  });

  it('labels a unitless portion a serving', () => {
    expect(nutrientsPerBase({ kcal: 250 }, { qty: 1 })?.servings[0]?.unit).toBe('serving');
  });

  it('returns null when there is nothing to pin', () => {
    expect(nutrientsPerBase({}, { qty: 1 })).toBeNull();
    expect(nutrientsPerBase({ kcal: 100 }, { qty: 0 })?.macros_per_base.kcal).toBe(100); // qty 0 → inferred 1
  });
});

/**
 * THE CONTRACT. Pin an estimate, then price the same portion back out of the pinned food: the
 * numbers must come back. If this ever fails, a user's parfait silently changes price the second
 * time they log it — which is the entire bug this project exists to fix.
 */
describe('round-trip: pin then price', () => {
  const cases: Array<{ name: string; est: FoodNutrients; portion: { qty?: number; unit?: string; text?: string } }> = [
    { name: 'a venti latte', est: { kcal: 250, protein_g: 12, fat_g: 9 }, portion: { qty: 1, unit: 'latte' } },
    { name: '3 eggs', est: { kcal: 210, protein_g: 18 }, portion: { qty: 3, unit: 'egg' } },
    { name: '170 g yogurt', est: { kcal: 100, protein_g: 17 }, portion: { qty: 170, unit: 'g' } },
    { name: '2 oz almonds', est: { kcal: 328, fat_g: 28 }, portion: { qty: 2, unit: 'oz' } },
    { name: '500 ml smoothie', est: { kcal: 320, carbs_g: 60 }, portion: { qty: 500, unit: 'ml' } },
    { name: 'a bowl of oatmeal', est: { kcal: 300, fiber_g: 8 }, portion: { qty: 1, unit: 'bowl' } },
    { name: 'half a bagel', est: { kcal: 140, carbs_g: 27 }, portion: { qty: 0.5, unit: 'bagel' } },
    { name: 'a parfait, no unit given', est: { kcal: 380, protein_g: 14 }, portion: { qty: 1 } },
  ];

  for (const c of cases) {
    it(`survives ${c.name}`, () => {
      const pin = nutrientsPerBase(c.est, c.portion);
      expect(pin).not.toBeNull();
      const priced = priceFood({ ...pin!, macros_per_base: pin!.macros_per_base }, c.portion);
      for (const [key, value] of Object.entries(c.est)) {
        // Tolerance is rounding only (scaleNutrients keeps 1dp on kcal/grams).
        expect(priced[key as keyof FoodNutrients]).toBeCloseTo(value as number, 1);
      }
    });
  }

  it('reproduces the SAME price on every later log, not merely a close one', () => {
    const pin = nutrientsPerBase({ kcal: 380, protein_g: 14 }, { qty: 1, unit: 'parfait' })!;
    const food = { ...pin };
    const prices = [1, 2, 3].map(() => priceFood(food, { qty: 1, unit: 'parfait', text: 'yogurt parfait' }));
    expect(prices[1]).toEqual(prices[0]);
    expect(prices[2]).toEqual(prices[0]);
  });
});
