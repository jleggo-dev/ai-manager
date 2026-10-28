/**
 * Tap grammar is a router (which row a second tap doubles, which chip a bracket becomes), and
 * routers fail silently — so positives AND near-misses: a food in a bracket is not the loose
 * row a tap doubles; two brackets of one recipe are one chip; an unnamed bracket counts its
 * members in words.
 */
import { describe, expect, it } from 'vitest';
import type { MealItem, MealPart } from '@cadence/shared';
import { badgeFor, cartChips, looseIndexOf, recipePortions, tapsOf, tileCount } from './cartModel.ts';

const item = (name: string, over: Partial<MealItem> = {}): MealItem => ({ name, qty: 1, unit: 'cup', ...over });
const part = (key: string, over: Partial<MealPart> = {}): MealPart => ({ key, name: null, ...over });

describe('looseIndexOf', () => {
  const items = [
    item('Yogurt', { food_id: 'f-yog', part: 'p1' }),
    item('Banana', { food_id: 'f-ban' }),
    item('Banana', { food_id: 'f-ban' }),
  ];
  it('finds the LAST loose row for the food', () => {
    expect(looseIndexOf(items, 'f-ban')).toBe(2);
  });
  it('a row inside a bracket is not the loose row', () => {
    expect(looseIndexOf(items, 'f-yog')).toBe(-1);
  });
  it('absent is -1', () => {
    expect(looseIndexOf(items, 'f-egg')).toBe(-1);
  });
});

describe('tapsOf', () => {
  it.each([
    [1, 1, 1],
    [2, 1, 2],
    [1.5, 0.5, 3],
    [1, undefined, 1],
    [2, undefined, 1],
    [0.5, 0.5, 1],
  ])('qty %s over base %s is %i taps', (qty, base, taps) => {
    expect(tapsOf(item('x', { qty }), base)).toBe(taps);
  });
  it('an unsettled amount (no qty) is one tap', () => {
    expect(tapsOf({ name: 'x' }, undefined)).toBe(1);
  });
});

describe('recipePortions', () => {
  it('sums servings across every bracket of the recipe', () => {
    const parts = [
      part('a', { recipe_id: 'r1', servings_logged: 1 }),
      part('b', { recipe_id: 'r1', servings_logged: 2 }),
      part('c', { recipe_id: 'r2' }),
    ];
    expect(recipePortions(parts, 'r1')).toBe(3);
    expect(recipePortions(parts, 'r2')).toBe(1);
    expect(recipePortions(parts, 'r3')).toBe(0);
  });
});

describe('tileCount / badgeFor', () => {
  const bases = new Map([['f-ban', 1]]);
  const items = [item('Banana', { food_id: 'f-ban', qty: 2 }), item('Oats', { food_id: 'f-oat', part: 'p1' })];
  const parts = [part('p1', { recipe_id: 'r-bowl', servings_logged: 1 })];

  it.each([
    [{ kind: 'food', id: 'f-ban' }, 2, '×2'],
    [{ kind: 'food', id: 'f-oat' }, 0, '✓'],
    [{ kind: 'food', id: 'f-egg' }, 0, '✓'],
    [{ kind: 'recipe', id: 'r-bowl' }, 1, '✓'],
    [{ kind: 'leftover', id: 'r-bowl' }, 1, '✓'],
    [{ kind: 'recipe', id: 'r-none' }, 0, '✓'],
  ] as const)('%o counts %i', (tile, count, badge) => {
    expect(tileCount(tile, items, parts, bases)).toBe(count);
    expect(badgeFor(count)).toBe(badge);
  });
});

describe('cartChips', () => {
  it('a loose row is one chip, doubled rows say so', () => {
    const items = [item('Banana', { food_id: 'f-ban', qty: 2 }), item('Flat white', { food_id: 'f-fw' })];
    const chips = cartChips(items, [], new Map([['f-ban', 1]]));
    expect(chips.map((c) => c.label)).toEqual(['2× Banana', 'Flat white']);
    expect(chips[0]).toMatchObject({ loose: true, indexes: [0] });
  });

  it('a named bracket is one chip carrying every member', () => {
    const items = [item('Yogurt', { part: 'p1' }), item('Chia', { part: 'p1' }), item('Coffee')];
    const parts = [part('p1', { name: 'Yogurt bowl', recipe_id: 'r-bowl' })];
    const chips = cartChips(items, parts, new Map());
    expect(chips.map((c) => c.label)).toEqual(['Yogurt bowl', 'Coffee']);
    expect(chips[0]).toMatchObject({ loose: false, indexes: [0, 1] });
  });

  it('two brackets of one recipe (tap, tap) are one chip, "2×"', () => {
    const items = [item('Yogurt', { part: 'p1' }), item('Yogurt', { part: 'p2' })];
    const parts = [
      part('p1', { name: 'Yogurt bowl', recipe_id: 'r-bowl' }),
      part('p2', { name: 'Yogurt bowl', recipe_id: 'r-bowl' }),
    ];
    const chips = cartChips(items, parts, new Map());
    expect(chips).toHaveLength(1);
    expect(chips[0]).toMatchObject({ label: '2× Yogurt bowl', indexes: [0, 1] });
  });

  it('a bracket logged at two servings reads 2× too', () => {
    const items = [item('Stew', { part: 'p1' })];
    const parts = [part('p1', { name: 'Lentil stew', recipe_id: 'r-stew', yield_servings: 4, servings_logged: 2 })];
    expect(cartChips(items, parts, new Map())[0]?.label).toBe('2× Lentil stew');
  });

  it('an unnamed bracket counts its members in words', () => {
    const items = [item('Eggs', { part: 'p1' }), item('Toast', { part: 'p1' })];
    expect(cartChips(items, [part('p1')], new Map())[0]?.label).toBe('two things');
  });

  it('a row naming a bracket the meal no longer holds is skipped, not crashed on', () => {
    const items = [item('Ghost', { part: 'gone' }), item('Coffee')];
    expect(cartChips(items, [], new Map()).map((c) => c.label)).toEqual(['Coffee']);
  });
});
