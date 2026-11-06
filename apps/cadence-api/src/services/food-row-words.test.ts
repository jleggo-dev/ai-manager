/**
 * Table test: what a picked row calls the food and the amount. Positives AND near-misses, since a
 * wrong word here fails in silence (the card simply says the wrong thing).
 */
import { describe, expect, it } from 'vitest';
import { amountAsSaid, nameForRow } from './food-row-words.ts';
import { priceFood } from './food-pricing-portion.ts';

describe('nameForRow', () => {
  it.each([
    ['Draught (Can)', 'Pint of guinness on draft', 'Draught'],
    ['Draught (Can)', 'a guinness', 'Draught'],
    ['Lager (Bottle)', 'a pint of lager', 'Lager'],
    ['Lager (Tall Can)', 'lager on tap', 'Lager'],
    // They said the container: the record's name is true as written.
    ['Draught (Can)', 'a can of guinness', 'Draught (Can)'],
    ['Draught (Can)', '2 cans of guinness', 'Draught (Can)'],
    ['Lager (Bottle)', 'one bottle of lager', 'Lager (Bottle)'],
    // Near-misses: a bracket that is not a container, a container that is not in a bracket.
    ['Peaches (in juice)', 'peaches', 'Peaches (in juice)'],
    ['Canadian Bacon (Sliced)', 'bacon', 'Canadian Bacon (Sliced)'],
    ['Can Can Cookies', 'cookies', 'Can Can Cookies'],
    ['(Can)', 'a guinness', '(Can)'],
  ])('%s, said "%s" → %s', (name, said, want) => {
    expect(nameForRow(name, said)).toBe(want);
  });
});

describe('amountAsSaid', () => {
  const item = { base_unit: 'item' as const };
  it.each([
    ['Pint of guinness on draft', { qty: 1, unit: 'pint' }],
    ['2 pints of guinness', { qty: 2, unit: 'pint' }],
    ['one pint of Rickards red', { qty: 1, unit: 'pint' }],
    ['500 ml coke', { qty: 500, unit: 'ml' }],
    ['8 oz steak', { qty: 8, unit: 'oz' }],
  ])('"%s" keeps its amount', (said, want) => {
    expect(amountAsSaid(item, said)).toEqual(want);
  });

  it.each([['a guinness'], ['2 cans of guinness'], ['half a wrap'], ['guinness'], ['pinto beans'], ['2 pinto beans']])(
    '"%s" is not a weight or a volume, so the record\'s measure stands',
    (said) => {
      expect(amountAsSaid(item, said)).toBeNull();
    },
  );

  it('a food kept by weight or volume reads the amount itself', () => {
    expect(amountAsSaid({ base_unit: 'g' }, '8 oz steak')).toBeNull();
    expect(amountAsSaid({ base_unit: 'ml' }, 'a pint of milk')).toBeNull();
  });

  it('the store cannot read a pint back on a per-item record, so the confirm keeps the card numbers', () => {
    const can = {
      base_unit: 'item' as const,
      macros_per_base: { kcal: 155, protein_g: 0.4, carbs_g: 12.3, fat_g: 0 },
      servings: [{ unit: 'serving', label: '1 can', amount_g: 1 }],
      default_serving: 0,
    };
    expect(priceFood(can, { qty: 1, unit: 'pint', text: '1 pint' })).toEqual({});
  });
});
