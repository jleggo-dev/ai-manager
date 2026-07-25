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
