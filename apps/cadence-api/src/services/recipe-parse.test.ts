import { describe, it, expect } from 'vitest';
import { parseStructureRecipeResult } from './recipe-parse.ts';

describe('parseStructureRecipeResult', () => {
  it('parses a well-formed structure_recipe payload', () => {
    const raw = JSON.stringify({
      name: 'Beef chili',
      servings: 6,
      ingredients: [
        { name: 'ground beef', qty: 500, unit: 'g' },
        { name: 'beans', qty: 2, unit: 'can' },
        { name: 'onion', qty: 1, unit: 'item' },
      ],
      steps: ['Brown beef', 'Simmer'],
    });
    const r = parseStructureRecipeResult(raw);
    expect(r.name).toBe('Beef chili');
    expect(r.servings).toBe(6);
    expect(r.ingredients).toHaveLength(3);
    expect(r.ingredients[0]).toEqual({ name: 'ground beef', qty: 500, unit: 'g' });
    expect(r.steps).toEqual(['Brown beef', 'Simmer']);
  });

  it('defaults servings to 1 and drops bad ingredients', () => {
    const r = parseStructureRecipeResult(
      JSON.stringify({
        name: 'Oats',
        servings: -1,
        ingredients: [{ name: 'oats', qty: 80, unit: 'g' }, { name: '', qty: 1 }, { qty: 2 }],
      }),
    );
    expect(r.servings).toBe(1);
    expect(r.ingredients).toEqual([{ name: 'oats', qty: 80, unit: 'g' }]);
  });

  it('throws on non-JSON or empty ingredients', () => {
    expect(() => parseStructureRecipeResult('NOT_JSON')).toThrow(/non-JSON/);
    expect(() => parseStructureRecipeResult(JSON.stringify({ name: 'X', ingredients: [] }))).toThrow(
      /no usable ingredients/,
    );
  });
});

/**
 * The amount, and only the amount, may be unknown. The job now answers `null` instead of picking
 * "one reasonable qty" — so every reading of `qty` that is not a positive number must land on
 * `null`, never on 0 or 1. A number here would be indistinguishable from an amount the person
 * actually gave, which is the whole failure this table guards (FOOD-ENGINE.md §2.1).
 */
describe('parseStructureRecipeResult — the amount may be unknown', () => {
  const parseQty = (qty: unknown): number | null => {
    const raw = JSON.stringify({ name: 'X', servings: 1, ingredients: [{ name: 'onion', qty, unit: 'item' }] });
    return parseStructureRecipeResult(raw).ingredients[0]!.qty;
  };

  const table: Array<[label: string, input: unknown, expected: number | null]> = [
    ['a positive number', 500, 500],
    ['a fractional number', 0.5, 0.5],
    ['an explicit null', null, null],
    ['a numeric string', '2', 2],
    ['a word instead of a number', 'some', null],
    ['an empty string', '', null],
    ['zero', 0, null],
    ['a negative number', -3, null],
    ['not a number at all', {}, null],
  ];

  for (const [label, input, expected] of table) {
    it(`reads ${label} as ${expected === null ? 'unstated' : String(expected)}`, () => {
      expect(parseQty(input)).toBe(expected);
    });
  }

  it('keeps an ingredient whose amount is missing entirely', () => {
    const r = parseStructureRecipeResult(
      JSON.stringify({
        name: 'Beef chili',
        servings: 6,
        ingredients: [{ name: 'ground beef', qty: 500, unit: 'g' }, { name: 'onion' }],
      }),
    );
    expect(r.ingredients).toEqual([
      { name: 'ground beef', qty: 500, unit: 'g' },
      { name: 'onion', qty: null },
    ]);
  });

  it('still drops a row with no name, amount or not', () => {
    const r = parseStructureRecipeResult(
      JSON.stringify({ name: 'X', ingredients: [{ name: 'oats', qty: null }, { qty: null }, { name: '  ' }] }),
    );
    expect(r.ingredients).toEqual([{ name: 'oats', qty: null }]);
  });
});
