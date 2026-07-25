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
});
