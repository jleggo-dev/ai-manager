import { describe, it, expect } from 'vitest';
import type { NutritionLog } from '@cadence/shared';
import { tallyUsual } from './coach-food-usual-tally.ts';

function meal(partial: Partial<NutritionLog> & Pick<NutritionLog, 'meal'>): NutritionLog {
  return {
    log_id: partial.log_id ?? 'l1',
    date: partial.date ?? '2026-07-20',
    meal: partial.meal,
    items: partial.items ?? [],
    macros: partial.macros ?? {},
    input_method: partial.input_method ?? 'text',
    recipe_id: partial.recipe_id ?? null,
    raw_text: partial.raw_text ?? null,
    ...(partial.parts ? { parts: partial.parts } : {}),
  };
}

describe('tallyUsual', () => {
  it('ranks recipe_id and food_id by meal frequency', () => {
    const logs = [
      meal({ meal: 'breakfast', recipe_id: 'r-oats', items: [{ name: 'oats' }] }),
      meal({ meal: 'breakfast', recipe_id: 'r-oats', items: [{ name: 'oats' }] }),
      meal({ meal: 'breakfast', items: [{ name: 'yogurt', food_id: 'f-yog' }] }),
      meal({ meal: 'lunch', recipe_id: 'r-oats', items: [{ name: 'oats' }] }),
    ];
    const tallied = tallyUsual(logs, 'breakfast');
    expect(tallied[0]?.kind).toBe('recipe');
    expect(tallied[0]?.id).toBe('r-oats');
    expect(tallied[0]?.count).toBe(2);
    expect(tallied.some((t) => t.id === 'f-yog')).toBe(true);
  });

  it('counts a bracket saved to the cookbook as a recipe, and not its members as loose foods', () => {
    // Owner, 2026-09-08: "Latte homemade" named at breakfast has to come back on the shelf as a
    // recipe. Its milk and espresso are the recipe, not two more breakfast foods.
    const logs = [
      meal({
        meal: 'breakfast',
        items: [
          { name: 'Milk', food_id: 'f-milk', part: 'p1' },
          { name: 'Espresso', food_id: 'f-esp', part: 'p1' },
          { name: 'Banana', food_id: 'f-ban' },
        ],
        parts: [{ key: 'p1', name: 'Latte homemade', recipe_id: 'r-latte' }],
      }),
      // An unnamed, unsaved bracket is still just its foods.
      meal({
        meal: 'breakfast',
        items: [
          { name: 'Milk', food_id: 'f-milk', part: 'p1' },
          { name: 'Oats', food_id: 'f-oats', part: 'p1' },
        ],
        parts: [{ key: 'p1', name: null }],
      }),
    ];
    const tallied = tallyUsual(logs, 'breakfast');
    const latte = tallied.find((t) => t.id === 'r-latte');
    expect(latte).toMatchObject({ kind: 'recipe', label: 'Latte homemade', count: 1 });
    expect(tallied.find((t) => t.id === 'f-esp')).toBeUndefined();
    expect(tallied.find((t) => t.id === 'f-milk')?.count).toBe(1);
    expect(tallied.find((t) => t.id === 'f-ban')?.count).toBe(1);
    expect(tallied.find((t) => t.id === 'f-oats')?.count).toBe(1);
  });
});
