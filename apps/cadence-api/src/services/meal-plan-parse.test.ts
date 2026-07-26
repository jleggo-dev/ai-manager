import { describe, expect, it } from 'vitest';
import {
  categorizeGrocery,
  deriveShoppingList,
  formatFridgeForJob,
  parseGenerateMealPlanResult,
  parseShoppingListItem,
} from './meal-plan-parse.ts';

describe('parseGenerateMealPlanResult', () => {
  it('parses a week plan + shopping list and forces checked false', () => {
    const raw = JSON.stringify({
      days: [
        {
          day: '2026-07-27',
          meals: [
            {
              slot: 'dinner',
              recipe: {
                name: 'Chili',
                servings: 4,
                ingredients: [{ name: 'beef', qty: 500, unit: 'g' }],
                steps: ['Simmer'],
                tags: ['batch'],
                reuse_recipe_id: null,
              },
            },
          ],
        },
      ],
      shopping_list: [{ name: 'beef', qty: '500g', category: 'protein', checked: true }],
      notes: 'Batch chili mid-week.',
    });
    const parsed = parseGenerateMealPlanResult(raw);
    expect(parsed.days).toHaveLength(1);
    expect(parsed.days[0]!.meals[0]!.recipe.name).toBe('Chili');
    expect(parsed.shopping_list[0]).toEqual({
      name: 'beef',
      qty: '500g',
      category: 'protein',
      checked: false,
    });
    expect(parsed.notes).toBe('Batch chili mid-week.');
  });

  it('drops bad days and allows empty plan', () => {
    const parsed = parseGenerateMealPlanResult(
      JSON.stringify({ days: [{ day: 'not-a-date', meals: [] }], shopping_list: [], notes: 'thin' }),
    );
    expect(parsed.days).toEqual([]);
    expect(parsed.notes).toBe('thin');
  });

  it('rejects non-JSON', () => {
    expect(() => parseGenerateMealPlanResult('not json')).toThrow(/non-JSON/);
  });
});

describe('deriveShoppingList', () => {
  it('merges ingredients and subtracts fridge by name', () => {
    const list = deriveShoppingList(
      [
        {
          ingredients: [
            { name: 'Spinach', qty: 1, unit: 'bag' },
            { name: 'eggs', qty: 4, unit: 'item' },
          ],
        },
        {
          ingredients: [
            { name: 'spinach', qty: 1, unit: 'bag' },
            { name: 'cheddar', qty: 100, unit: 'g' },
          ],
        },
      ],
      [{ name: 'eggs' }],
    );
    const names = list.map((i) => i.name.toLowerCase());
    expect(names).toContain('spinach');
    expect(names).toContain('cheddar');
    expect(names).not.toContain('eggs');
    expect(list.find((i) => i.name.toLowerCase() === 'spinach')?.qty).toMatch(/2/);
  });
});

describe('categorizeGrocery / formatFridgeForJob', () => {
  it('buckets common groceries', () => {
    expect(categorizeGrocery('chicken thighs')).toBe('protein');
    expect(categorizeGrocery('spinach')).toBe('produce');
    expect(categorizeGrocery('rice')).toBe('pantry');
  });

  it('formats fridge rows for the job', () => {
    expect(formatFridgeForJob([{ name: 'eggs', qty: 6, unit: 'item' }])).toBe('eggs 6 item');
  });

  it('parses shopping list items with fallback category', () => {
    expect(parseShoppingListItem({ name: 'tofu', qty: '1 pack', category: 'weird' })).toEqual({
      name: 'tofu',
      qty: '1 pack',
      category: 'other',
      checked: false,
    });
  });
});
