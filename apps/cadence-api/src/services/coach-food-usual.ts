/**
 * "Usual breakfast" (etc.) — pick the user's most-logged food/recipe for that meal.
 * Falls back to resolveFoods when history is thin.
 */
import { assessDietarySafety, type DietaryProfile, type MealKind } from '@cadence/shared';
import { getFood } from '../repos/foods.ts';
import { getRecipe } from '../repos/recipes.ts';
import { listNutritionLogs } from '../repos/nutrition.ts';
import { getDietaryProfile } from '../repos/users.ts';
import { resolveFoods, type ResolveResult } from './food-resolver.ts';
import { pickPreselected, type ResolveCandidate } from './food-resolver-types.ts';
import { tallyUsual, type UsualCounted } from './coach-food-usual-tally.ts';

export { tallyUsual } from './coach-food-usual-tally.ts';

function isoDaysAgo(days: number): { from: string; to: string } {
  const now = Date.now();
  return {
    from: new Date(now - days * 86_400_000).toISOString().slice(0, 10),
    to: new Date(now).toISOString().slice(0, 10),
  };
}

async function toCandidate(
  userId: string,
  row: UsualCounted,
  score: number,
  profile: DietaryProfile | null,
): Promise<ResolveCandidate | null> {
  if (row.kind === 'food') {
    const food = await getFood(userId, row.id);
    if (!food) return null;
    const dietary = assessDietarySafety(profile, [food.name, food.brand ?? '']);
    const adjusted = dietary.safe ? score : Math.min(score, 0.05);
    return {
      kind: 'food',
      score: adjusted,
      label: food.brand ? `${food.name} (${food.brand})` : food.name,
      food_id: food.food_id,
      brand: food.brand,
      preselected_serving: food.default_serving ?? 0,
      inferred_quantity: 1,
      dietary,
    };
  }
  const recipe = await getRecipe(userId, row.id);
  if (!recipe) return null;
  const texts = [recipe.name, ...recipe.ingredients.map((i) => i.name)];
  const dietary = assessDietarySafety(profile, texts);
  const adjusted = dietary.safe ? score : Math.min(score, 0.05);
  return {
    kind: 'recipe',
    score: adjusted,
    label: recipe.name,
    recipe_id: recipe.recipe_id,
    inferred_quantity: 1,
    dietary,
  };
}

/**
 * Resolve "usual {meal}" from the user's logging history (recents/frequents by meal).
 * Falls back to resolveFoods({ text: meal }) when history is thin.
 */
export async function resolveUsualMeal(userId: string, meal: MealKind): Promise<ResolveResult> {
  const { from, to } = isoDaysAgo(45);
  const [logs, profile] = await Promise.all([listNutritionLogs(userId, from, to), getDietaryProfile(userId)]);
  const tallied = tallyUsual(logs, meal).slice(0, 8);

  if (tallied.length === 0) {
    return resolveFoods(userId, { text: meal });
  }

  const candidates: ResolveCandidate[] = [];
  for (let i = 0; i < tallied.length; i++) {
    const score = Math.max(0.35, 1.2 - i * 0.12);
    const c = await toCandidate(userId, tallied[i]!, score, profile);
    if (c) candidates.push(c);
  }
  candidates.sort((a, b) => b.score - a.score);

  if (candidates.length === 0) return resolveFoods(userId, { text: meal });
  return { candidates, preselected: pickPreselected(candidates) };
}
