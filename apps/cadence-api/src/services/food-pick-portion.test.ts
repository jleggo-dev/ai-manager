/**
 * A pick becomes a row the card can show and the confirm can re-price. Positives: the measure's
 * own word reads back. Near-misses: a label whose word the pricer cannot read falls to grams,
 * and a per-item food asked for in grams is refused rather than guessed.
 */
import { describe, expect, it } from 'vitest';
import type { Food } from '@cadence/shared';
import { priceFood } from './food-pricing-portion.ts';
import { portionForPick } from './food-pick-portion.ts';

const banana: Pick<Food, 'base_unit' | 'macros_per_base' | 'servings' | 'default_serving'> = {
  base_unit: 'g',
  macros_per_base: { kcal: 89, protein_g: 1.1, carbs_g: 22.8, fat_g: 0.3 },
  servings: [
    { label: '1 medium (118g)', unit: 'medium', amount_g: 118 },
    { label: '1 cup, sliced', unit: 'cup', amount_g: 150 },
    { label: '100 g', unit: 'g', amount_g: 100 },
  ],
  default_serving: 0,
};
const coffee: typeof banana = {
  base_unit: 'ml',
  macros_per_base: { kcal: 1, protein_g: 0.1 },
  servings: [
    { label: '1 coffee cup (6 fl oz)', unit: 'ml', amount_g: 177 },
    { label: '1 mug (8 fl oz)', unit: 'ml', amount_g: 237 },
  ],
  default_serving: 1,
};
const egg: typeof banana = {
  base_unit: 'item',
  macros_per_base: { kcal: 72, protein_g: 6.3 },
  servings: [{ label: '1 egg', unit: 'item', amount_g: 1 }],
  default_serving: 0,
};

describe('portionForPick', () => {
  it('a named measure that reads back is written in its own word', () => {
    const p = portionForPick(banana, { label: '1 medium (118g)', grams: 118 }, 2);
    expect(p).toMatchObject({ qty: 2, unit: 'medium', reads_back: true });
    // scaleNutrients rounds to a tenth, as every stored number is.
    expect(p?.est.kcal).toBeCloseTo(89 * 2.36, 0);
    // The confirm's re-pricing gives the same numbers.
    expect(priceFood(banana, { qty: 2, unit: 'medium', text: '2 medium' }).kcal).toBe(p!.est.kcal);
  });

  it('a volume measure reads back by its unit', () => {
    const p = portionForPick(banana, { label: '1 cup, sliced', grams: 150 }, 1.5);
    expect(p).toMatchObject({ qty: 1.5, unit: 'cup', reads_back: true });
    expect(p?.est.kcal).toBeCloseTo(89 * 2.25, 0);
  });

  it('grams are grams', () => {
    const p = portionForPick(banana, { label: 'g', grams: 1 }, 80);
    expect(p).toMatchObject({ qty: 80, unit: 'g', reads_back: true });
    expect(p?.est.kcal).toBeCloseTo(71.2, 3);
  });

  it("a label whose unit is bare ml reads back by the label's own noun", () => {
    // Both rows carry unit "ml", which never names a serving; the noun in the label does.
    const p = portionForPick(coffee, { label: '1 mug (8 fl oz)', grams: 237 }, 1);
    expect(p).toMatchObject({ qty: 1, unit: 'mug', reads_back: true });
    expect(p?.est.kcal).toBeCloseTo(2.4, 1);
    expect(priceFood(coffee, { qty: 1, unit: 'mug', text: '1 mug' }).kcal).toBe(p!.est.kcal);
  });

  it('a mass label with no word of its own is written in grams', () => {
    const p = portionForPick(banana, { label: '100 g', grams: 100 }, 1.5);
    expect(p).toMatchObject({ qty: 150, unit: 'g', reads_back: true });
    expect(p?.est.kcal).toBeCloseTo(133.5, 1);
  });

  it('a per-item food prices by its serving and never in grams', () => {
    expect(portionForPick(egg, { label: '1 egg', grams: 1 }, 2)).toMatchObject({
      qty: 2,
      unit: 'egg',
      reads_back: true,
    });
    expect(portionForPick(egg, { label: '1 egg', grams: 1 }, 2)?.est.kcal).toBe(144);
    expect(portionForPick(egg, { label: 'g', grams: 1 }, 50)).toBeNull();
  });

  it('a food with no numbers prices nothing', () => {
    expect(portionForPick({ ...banana, macros_per_base: {} }, { label: 'g', grams: 1 }, 10)).toBeNull();
  });
});
