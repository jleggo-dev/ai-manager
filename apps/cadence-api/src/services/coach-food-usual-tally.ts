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
  for (const log of logs) {
    if (log.meal !== meal) continue;
    if (log.recipe_id) {
      const key = `recipe:${log.recipe_id}`;
      const prev = map.get(key);
      if (prev) prev.count += 1;
      else
        map.set(key, {
          key,
          kind: 'recipe',
          id: log.recipe_id,
          label: log.raw_text?.trim() || log.items[0]?.name || 'recipe',
          count: 1,
        });
      continue;
    }
    for (const item of log.items) {
      if (!item.food_id) continue;
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
