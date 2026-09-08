/**
 * Pure "usual meal" frequency tally over nutrition_logs (no DB).
 */
import type { MealKind, NutritionLog } from '@cadence/shared';

export interface UsualCounted {
  key: string;
  kind: 'food' | 'recipe';
  id: string;
  label: string;
  count: number;
}

export function tallyUsual(logs: NutritionLog[], meal: MealKind): UsualCounted[] {
  const map = new Map<string, UsualCounted>();
  const countRecipe = (recipeId: string, label: string) => {
    const key = `recipe:${recipeId}`;
    const prev = map.get(key);
    if (prev) prev.count += 1;
    else map.set(key, { key, kind: 'recipe', id: recipeId, label, count: 1 });
  };
  for (const log of logs) {
    if (log.meal !== meal) continue;
    if (log.recipe_id) {
      countRecipe(log.recipe_id, log.raw_text?.trim() || log.items[0]?.name || 'recipe');
      continue;
    }
    // A bracket saved to the cookbook (the meal screen's "Name this recipe") is a recipe logged
    // at this slot too — counted as one thing, its members not counted again as loose foods
    // (owner, 2026-09-08: the named latte has to come back as a recipe, not as milk + espresso).
    const recipeParts = new Set<string>();
    for (const part of log.parts ?? []) {
      if (!part.recipe_id) continue;
      recipeParts.add(part.key);
      countRecipe(part.recipe_id, part.name?.trim() || 'recipe');
    }
    for (const item of log.items) {
      if (!item.food_id) continue;
      if (item.part && recipeParts.has(item.part)) continue;
      const key = `food:${item.food_id}`;
      const prev = map.get(key);
      if (prev) prev.count += 1;
      else
        map.set(key, {
          key,
          kind: 'food',
          id: item.food_id,
          label: item.name,
          count: 1,
        });
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}
