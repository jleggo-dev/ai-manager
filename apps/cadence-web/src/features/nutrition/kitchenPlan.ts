import type { MealPlanDay, MealPlanMeal, MealPlanSlotKind, Recipe } from '@cadence/shared';

/**
 * The Kitchen's week arithmetic, kept pure (Food Journey 10b/10c).
 *
 * Composing a week is all edits to one `MealPlanDay[]`: put this recipe on Wednesday dinner, take
 * that one off Friday. The rules the server enforces are encoded here rather than discovered by a
 * 400 — a day carries at least one meal or it is not in the list, and a slot holds one recipe, so
 * planning over a filled slot replaces rather than stacks.
 */

/** The slots a week is planned in, in the order a day runs. */
export const KITCHEN_SLOTS: MealPlanSlotKind[] = ['breakfast', 'lunch', 'dinner', 'snack'];

export const SLOT_LABEL: Record<MealPlanSlotKind, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
};

/** The seven local dates of the week beginning `weekOf` (a Monday, per `weekOfMonday`). */
export function weekDaysFrom(weekOf: string): string[] {
  const [y, m, d] = weekOf.split('-').map(Number);
  const start = new Date(y ?? 2026, (m ?? 1) - 1, d ?? 1);
  return Array.from({ length: 7 }, (_, i) => {
    const dt = new Date(start);
    dt.setDate(start.getDate() + i);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  });
}

/** "Wed 26 Aug" — a planned day's own words. */
export function dayLabel(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y ?? 2026, (m ?? 1) - 1, d ?? 1);
  return dt.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function mealsFor(days: MealPlanDay[], day: string): MealPlanMeal[] {
  return days.find((d) => d.day === day)?.meals ?? [];
}

export function mealAt(days: MealPlanDay[], day: string, slot: string): MealPlanMeal | null {
  return mealsFor(days, day).find((m) => m.slot === slot) ?? null;
}

/** How many meals the whole week holds — the Kitchen's one honest count. */
export function plannedCount(days: MealPlanDay[]): number {
  return days.reduce((n, d) => n + d.meals.length, 0);
}

function sortDays(days: MealPlanDay[]): MealPlanDay[] {
  return [...days].sort((a, b) => a.day.localeCompare(b.day));
}

function sortMeals(meals: MealPlanMeal[]): MealPlanMeal[] {
  const order = (s: string) => {
    const i = KITCHEN_SLOTS.indexOf(s as MealPlanSlotKind);
    return i === -1 ? KITCHEN_SLOTS.length : i;
  };
  return [...meals].sort((a, b) => order(a.slot) - order(b.slot));
}

/**
 * Put a recipe on a day and slot. One recipe per slot: planning over Wednesday dinner replaces
 * what was there, because two dinners on one Wednesday is a data shape nobody asked for.
 */
export function addMeal(
  days: MealPlanDay[],
  day: string,
  slot: string,
  recipe: Pick<Recipe, 'recipe_id' | 'name'>,
): MealPlanDay[] {
  const meal: MealPlanMeal = { slot, recipe_id: recipe.recipe_id, recipe_name: recipe.name };
  const existing = days.find((d) => d.day === day);
  if (!existing) return sortDays([...days, { day, meals: [meal] }]);
  const meals = sortMeals([...existing.meals.filter((m) => m.slot !== slot), meal]);
  return sortDays(days.map((d) => (d.day === day ? { ...d, meals } : d)));
}

/**
 * Take a meal off. A day left with nothing drops out of the list entirely — the API's day schema
 * requires at least one meal, so an empty day is not a thing that can be saved.
 */
export function removeMeal(days: MealPlanDay[], day: string, slot: string): MealPlanDay[] {
  return days
    .map((d) => (d.day === day ? { ...d, meals: d.meals.filter((m) => m.slot !== slot) } : d))
    .filter((d) => d.meals.length > 0);
}

/** Every recipe the week plans, deduped and in week order — what the shopping list is derived from. */
export function plannedRecipes(days: MealPlanDay[], byId: Map<string, Recipe>): Recipe[] {
  const seen = new Set<string>();
  const out: Recipe[] = [];
  for (const d of sortDays(days)) {
    for (const m of d.meals) {
      if (seen.has(m.recipe_id)) continue;
      seen.add(m.recipe_id);
      const recipe = byId.get(m.recipe_id);
      if (recipe) out.push(recipe);
    }
  }
  return out;
}

/** A saved recipe as the confirm-a-week endpoint wants it — `reuse_recipe_id` keeps it the same row. */
export function toDraftRecipe(recipe: Recipe): {
  name: string;
  servings: number;
  ingredients: { name: string; qty: number; unit?: string }[];
  steps: string[];
  tags: string[];
  reuse_recipe_id: string;
} {
  return {
    name: recipe.name.slice(0, 120),
    servings: Math.max(1, Math.round(recipe.servings || 1)),
    ingredients: recipe.ingredients
      .map((i) => {
        const qty = typeof i.qty === 'number' ? i.qty : Number.parseFloat(String(i.qty));
        return {
          name: i.name.slice(0, 80),
          qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
          ...(i.unit ? { unit: i.unit.slice(0, 24) } : {}),
        };
      })
      .slice(0, 40),
    steps: recipe.steps.filter((s) => s.trim()).slice(0, 30),
    tags: recipe.tags.filter((t) => t.trim()).slice(0, 20),
    reuse_recipe_id: recipe.recipe_id,
  };
}
