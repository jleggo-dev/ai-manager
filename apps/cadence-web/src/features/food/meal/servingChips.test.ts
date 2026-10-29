/**
 * The chips decide what a one-tap amount means, so their labels and order are pinned here —
 * including the labels that must NOT be scaled (a CNF "(170g)" tail) and the plurals that must
 * not be invented ("1½ g" is not "1½ gs").
 */
import { describe, expect, it } from 'vitest';
import type { Food } from '@cadence/shared';
import { chipMatches, fmtQuantity, scaleServingLabel, servingChips } from './servingChips.ts';

describe('fmtQuantity', () => {
  it.each([
    [0.5, '½'],
    [0.25, '¼'],
    [0.75, '¾'],
    [1, '1'],
    [1.5, '1½'],
    [2, '2'],
    [2.25, '2¼'],
    [0.33, '0.3'],
  ])('%s → %s', (n, s) => {
    expect(fmtQuantity(n)).toBe(s);
  });
});

describe('scaleServingLabel', () => {
  it.each([
    ['1 cup', 0.5, '½ cup'],
    ['1 cup', 1, '1 cup'],
    ['1 cup', 1.5, '1½ cups'],
    ['2 tablespoons', 0.5, '1 tablespoon'],
    ['1 slice', 2, '2 slices'],
    ['100 g', 1.5, '150 g'],
    ['1 container (170g)', 0.5, '½ container'],
    ['½ cup', 2, '1 cup'],
    ['1 medium', 1.5, '1½ medium'],
    ['cup', 0.5, '½ cup'],
    ['1', 2, '2'],
  ])('%s × %s → %s', (label, q, expected) => {
    expect(scaleServingLabel(label, q)).toBe(expected);
  });
});

const food = (over: Partial<Food>): Pick<Food, 'brand' | 'source' | 'name' | 'servings' | 'default_serving'> => ({
  brand: null,
  source: 'cnf',
  name: 'Greek yogurt, 2%',
  default_serving: 0,
  servings: [
    { label: '1 cup', unit: 'cup', amount_g: 245 },
    { label: '170 g', unit: 'g', amount_g: 170 },
    { label: '1 container (170g)', unit: 'container', amount_g: 170 },
  ],
  ...over,
});

describe('servingChips', () => {
  it('leads with what a tap adds — the default serving at half, one, one-and-a-half — then the rest', () => {
    expect(servingChips(food({})).map((c) => c.label)).toEqual(['½ cup', '1 cup', '1½ cups', '170 g']);
  });

  it('a branded food whose default is its printed weight leads with that, volume after', () => {
    const chips = servingChips(food({ brand: 'Liberté', source: 'off', default_serving: 1 }));
    expect(chips.map((c) => c.label)).toEqual(['85 g', '170 g', '255 g', '1 cup']);
    expect(chips[0]).toMatchObject({ servingIndex: 1, quantity: 0.5 });
  });

  it('the rest follow the picker’s order: a count serving ("1 container") sorts after a measure', () => {
    const chips = servingChips(food({ default_serving: 1 }));
    expect(chips.map((c) => c.label)).toEqual(['85 g', '170 g', '255 g', '1 cup']);
  });

  it('never draws more than four — "Other…" is the door to the rest', () => {
    const many = food({
      servings: [
        { label: '1 cup', unit: 'cup', amount_g: 245 },
        { label: '100 g', unit: 'g', amount_g: 100 },
        { label: '1 container', unit: 'container', amount_g: 170 },
        { label: '1 tub', unit: 'tub', amount_g: 500 },
      ],
    });
    expect(servingChips(many)).toHaveLength(4);
  });

  it('a food with one serving still gets its three multiples', () => {
    const one = food({ servings: [{ label: '1 medium', unit: 'item', amount_g: 1 }] });
    expect(servingChips(one).map((c) => c.label)).toEqual(['½ medium', '1 medium', '1½ medium']);
  });

  it('no servings, no chips', () => {
    expect(servingChips(food({ servings: [] }))).toEqual([]);
  });
});

describe('chipMatches', () => {
  it('matches serving and quantity, not label', () => {
    const chip = { servingIndex: 0, quantity: 1.5, label: '1½ cups' };
    expect(chipMatches(chip, 0, 1.5)).toBe(true);
    expect(chipMatches(chip, 0, 1)).toBe(false);
    expect(chipMatches(chip, 1, 1.5)).toBe(false);
  });
});
