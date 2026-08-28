/**
 * MP3 (weight vs volume ordering) and MP39 (compound labels), pinned against the owner's own
 * examples and the messy real-world unit text CNF ships (see cnf-map.ts / its fixtures).
 */
import { describe, expect, it } from 'vitest';
import type { Food, FoodServing } from '@cadence/shared';
import { classifyServingUnit, compoundLabel, leadsWithWeight, orderServingIndices } from './servingPicker.ts';

type FoodMeta = Pick<Food, 'brand' | 'source' | 'name' | 'servings'>;

const food = (over: Partial<FoodMeta>): FoodMeta => ({
  brand: null,
  source: 'manual',
  name: 'Shallots',
  servings: [],
  ...over,
});

describe('classifyServingUnit', () => {
  it('reads clean short keys — the common case for manual/OFF foods', () => {
    expect(classifyServingUnit('g')).toBe('mass');
    expect(classifyServingUnit('ml')).toBe('volume');
    expect(classifyServingUnit('cup')).toBe('volume');
    expect(classifyServingUnit('container')).toBe('count');
    expect(classifyServingUnit('serving')).toBe('count');
  });

  it('reads CNF-style measure text glued straight to a number, no space', () => {
    expect(classifyServingUnit('100ml')).toBe('volume');
    expect(classifyServingUnit('1 bottle (341ml)')).toBe('volume');
    expect(classifyServingUnit('1 can (355 ml)')).toBe('volume');
  });

  it('does not mistake a count measure with a length descriptor for mass or volume', () => {
    // Real CNF banana measure — "cm" must never read as a unit of mass or volume.
    expect(classifyServingUnit('1 medium (18cm to 20cm long)')).toBe('count');
    expect(classifyServingUnit('1 extra small (less than 15cm long)')).toBe('count');
  });

  it('falls back to count on nonsense text rather than guessing', () => {
    expect(classifyServingUnit('no serving specified')).toBe('count');
    expect(classifyServingUnit(undefined)).toBe('count');
  });

  it('reads "fl oz" as volume, not mass, despite containing "oz"', () => {
    expect(classifyServingUnit('fl oz')).toBe('volume');
    expect(classifyServingUnit('3 oz')).toBe('mass');
  });
});

describe('leadsWithWeight — the owner heuristic', () => {
  it('leads with weight for a branded product — the number is already printed', () => {
    expect(leadsWithWeight(food({ brand: 'Borde', source: 'manual' }))).toBe(true);
  });

  it('leads with weight for meat, even unbranded', () => {
    expect(leadsWithWeight(food({ name: 'Chicken breast, raw', source: 'usda' }))).toBe(true);
  });

  it('leads with weight for a packaged-product source regardless of name', () => {
    expect(leadsWithWeight(food({ source: 'off', name: 'Trail mix' }))).toBe(true);
    expect(leadsWithWeight(food({ source: 'label_photo', name: 'Mixed dried mushrooms' }))).toBe(true);
  });

  it('does not need a scale for produce cooked from scratch', () => {
    expect(leadsWithWeight(food({ name: 'Shallots', source: 'cnf', brand: null }))).toBe(false);
    expect(leadsWithWeight(food({ name: 'Button mushrooms', source: 'cnf', brand: null }))).toBe(false);
  });
});

describe('orderServingIndices — never drops a serving, only reorders', () => {
  const servings: FoodServing[] = [
    { label: '1 cup, chopped (150g)', unit: 'cup', amount_g: 150 },
    { label: '100 g', unit: 'g', amount_g: 100 },
    { label: '1 shallot (40g)', unit: 'each', amount_g: 40 },
  ];

  it('leads with volume/count for scratch-cooked produce (owner: "nobody weighs three shallots")', () => {
    const order = orderServingIndices(food({ servings, source: 'cnf' }));
    expect(order).toHaveLength(3);
    expect(order[0]).not.toBe(1); // the gram row is not first
    expect(new Set(order)).toEqual(new Set([0, 1, 2])); // same three indices, just reordered
  });

  it('leads with weight for a branded / packaged food', () => {
    const order = orderServingIndices(food({ servings, brand: 'Acme' }));
    expect(order[0]).toBe(1); // the gram row leads
    expect(new Set(order)).toEqual(new Set([0, 1, 2]));
  });

  it('returns ORIGINAL indices, not a reordered copy — callers index food.servings by them', () => {
    const order = orderServingIndices(food({ servings, brand: 'Acme' }));
    for (const i of order) expect(servings[i]).toBe(servings[i]); // indices stay valid into the source array
  });
});

describe('compoundLabel — MP39', () => {
  it("matches the owner's own example: a container expressed in cups", () => {
    const container: FoodServing = { label: '1 container', unit: 'container', amount_g: 940 };
    const cup: FoodServing = { label: '1 cup', unit: 'cup', amount_g: 235 };
    expect(compoundLabel(container, [container, cup])).toBe('1 container (4 cups ea.)');
  });

  it('singularizes when the ratio is exactly one', () => {
    const pack: FoodServing = { label: '1 pack', unit: 'pack', amount_g: 235 };
    const cup: FoodServing = { label: '1 cup', unit: 'cup', amount_g: 235 };
    expect(compoundLabel(pack, [pack, cup])).toBe('1 pack (1 cup ea.)');
  });

  it('leaves a volume serving alone — it needs no compound suffix', () => {
    const cup: FoodServing = { label: '1 cup', unit: 'cup', amount_g: 235 };
    expect(compoundLabel(cup, [cup])).toBe('1 cup');
  });

  it('degrades to the plain label with no volume sibling to compare against', () => {
    const container: FoodServing = { label: '1 container', unit: 'container', amount_g: 940 };
    const grams: FoodServing = { label: '100 g', unit: 'g', amount_g: 100 };
    expect(compoundLabel(container, [container, grams])).toBe('1 container');
  });

  it('never relates a MASS serving to a volume one — that would be a density guess', () => {
    const grams: FoodServing = { label: '250 g', unit: 'g', amount_g: 250 };
    const cup: FoodServing = { label: '1 cup', unit: 'cup', amount_g: 235 };
    expect(compoundLabel(grams, [grams, cup])).toBe('250 g');
  });
});
