/**
 * Reading meal-plan JSON from the API into typed records — the persisted week, the unsaved AI draft,
 * and lists of either. Split out of meal-plans.ts (the fetch calls) to keep both under the size cap.
 */

import type { MealPlan, MealPlanDay, MealPlanItem, MealPlanMeal, ShoppingListItem } from '@cadence/shared';
/** Nested recipe on an unsaved generate draft (confirm creates recipes as needed). */
export type MealPlanRecipeDraft = {
  name: string;
  servings: number;
  ingredients: { name: string; qty: number; unit?: string }[];
  steps: string[];
  tags: string[];
  reuse_recipe_id: string | null;
  dietary?: { safe: boolean; flags?: unknown[] };
};

export type MealPlanDraftMeal = {
  slot: string;
  recipe: MealPlanRecipeDraft;
};

export type MealPlanDraftDay = {
  day: string;
  meals: MealPlanDraftMeal[];
};

/** Unsaved week from generate — confirm before POST /nutrition/meal-plans. */
export interface MealPlanDraft {
  week_of: string;
  days: MealPlanDraftDay[];
  shopping_list: ShoppingListItem[];
  notes: string | null;
  filtered_allergy?: number;
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object';
}

function parseShoppingItem(raw: unknown): ShoppingListItem | null {
  if (!isRecord(raw) || typeof raw.name !== 'string' || !raw.name.trim()) return null;
  return {
    name: raw.name.trim(),
    qty: typeof raw.qty === 'string' ? raw.qty : raw.qty != null ? String(raw.qty) : '',
    category: typeof raw.category === 'string' ? raw.category : 'other',
    checked: raw.checked === true,
  };
}

function parseShoppingList(raw: unknown): ShoppingListItem[] {
  if (!Array.isArray(raw)) return [];
  const out: ShoppingListItem[] = [];
  for (const row of raw) {
    const item = parseShoppingItem(row);
    if (item) out.push(item);
  }
  return out;
}

/**
 * One thing in a composed meal (frame 10a — "recipes, food, or both"). Mirrors the server's
 * `planItemSchema` (`apps/cadence-api/src/validation/meal-plan.ts`): kind + id + name + qty are
 * required, macros are denormalized and optional.
 */
function parsePlanItem(raw: unknown): MealPlanItem | null {
  if (!isRecord(raw)) return null;
  const kind = raw.kind === 'recipe' || raw.kind === 'food' ? raw.kind : null;
  const id = typeof raw.id === 'string' ? raw.id : '';
  const name = typeof raw.name === 'string' ? raw.name : '';
  const qty = typeof raw.qty === 'number' ? raw.qty : Number(raw.qty);
  if (!kind || !id.trim() || !name.trim() || !Number.isFinite(qty) || qty <= 0) return null;
  const item: MealPlanItem = { kind, id, name: name.trim(), qty };
  if (typeof raw.unit === 'string' && raw.unit.trim()) item.unit = raw.unit.trim();
  if (typeof raw.kcal === 'number') item.kcal = raw.kcal;
  if (typeof raw.protein_g === 'number') item.protein_g = raw.protein_g;
  if (typeof raw.carbs_g === 'number') item.carbs_g = raw.carbs_g;
  if (typeof raw.fat_g === 'number') item.fat_g = raw.fat_g;
  return item;
}

function parsePlanItems(raw: unknown): MealPlanItem[] {
  if (!Array.isArray(raw)) return [];
  const out: MealPlanItem[] = [];
  for (const row of raw) {
    const item = parsePlanItem(row);
    if (item) out.push(item);
  }
  return out;
}

/**
 * MP18 — the server persists a meal as EITHER the legacy single recipe (`recipe_id`) or a composed
 * list (`items`), never neither (see `persistedMealSchema`'s refine, same file). This used to hard
 * -require `recipe_id` and never read `items` or `name` at all, so every composed meal the server
 * saved correctly came back from a GET as if it had never been written. Mirror the server's own
 * either/or check instead of the old both-required one.
 */
function parsePersistedMeal(raw: unknown): MealPlanMeal | null {
  if (!isRecord(raw)) return null;
  const slot = typeof raw.slot === 'string' ? raw.slot : '';
  if (!slot.trim()) return null;
  const recipeId = typeof raw.recipe_id === 'string' ? raw.recipe_id : '';
  const items = parsePlanItems(raw.items);
  if (!recipeId.trim() && !items.length) return null;
  const meal: MealPlanMeal = { slot: slot.trim() };
  if (recipeId.trim()) meal.recipe_id = recipeId;
  if (items.length) meal.items = items;
  if (typeof raw.recipe_name === 'string' && raw.recipe_name.trim()) {
    meal.recipe_name = raw.recipe_name.trim();
  }
  if (typeof raw.name === 'string' && raw.name.trim()) {
    meal.name = raw.name.trim();
  }
  return meal;
}

function parsePersistedDay(raw: unknown): MealPlanDay | null {
  if (!isRecord(raw) || typeof raw.day !== 'string' || !raw.day.trim()) return null;
  const meals: MealPlanMeal[] = [];
  for (const m of Array.isArray(raw.meals) ? raw.meals : []) {
    const meal = parsePersistedMeal(m);
    if (meal) meals.push(meal);
  }
  return { day: raw.day.trim(), meals };
}

function unwrapPlanBody(body: unknown): unknown {
  if (isRecord(body) && 'meal_plan' in body) return body.meal_plan;
  if (isRecord(body) && 'plan' in body) return body.plan;
  if (isRecord(body) && 'draft' in body) return body.draft;
  return body;
}

/** Parse a persisted meal plan from API JSON. */
export function parseMealPlan(raw: unknown): MealPlan | null {
  const body = unwrapPlanBody(raw);
  if (!isRecord(body)) return null;
  const weekOf = typeof body.week_of === 'string' ? body.week_of : '';
  if (!weekOf.trim()) return null;
  const id = typeof body.meal_plan_id === 'string' ? body.meal_plan_id : '';
  const days: MealPlanDay[] = [];
  for (const d of Array.isArray(body.days) ? body.days : []) {
    const day = parsePersistedDay(d);
    if (day) days.push(day);
  }
  const plan: MealPlan = {
    meal_plan_id: id,
    week_of: weekOf.trim(),
    days,
    shopping_list: parseShoppingList(body.shopping_list),
  };
  if (typeof body.notes === 'string' || body.notes === null) plan.notes = body.notes;
  return plan;
}

function parseRecipeDraftNested(raw: unknown): MealPlanRecipeDraft | null {
  if (!isRecord(raw) || typeof raw.name !== 'string' || !raw.name.trim()) return null;
  const servings = typeof raw.servings === 'number' && raw.servings > 0 ? Math.max(1, Math.round(raw.servings)) : 1;
  const ingredients: MealPlanRecipeDraft['ingredients'] = [];
  for (const row of Array.isArray(raw.ingredients) ? raw.ingredients : []) {
    if (!isRecord(row) || typeof row.name !== 'string' || !row.name.trim()) continue;
    const qty = typeof row.qty === 'number' && row.qty > 0 ? row.qty : Number(row.qty);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const ing: MealPlanRecipeDraft['ingredients'][number] = { name: row.name.trim(), qty };
    if (typeof row.unit === 'string' && row.unit.trim()) ing.unit = row.unit.trim();
    ingredients.push(ing);
  }
  if (!ingredients.length) return null;
  const steps = Array.isArray(raw.steps)
    ? raw.steps.filter((s): s is string => typeof s === 'string' && !!s.trim())
    : [];
  const tags = Array.isArray(raw.tags) ? raw.tags.filter((t): t is string => typeof t === 'string' && !!t.trim()) : [];
  const reuse =
    typeof raw.reuse_recipe_id === 'string' && raw.reuse_recipe_id.trim() ? raw.reuse_recipe_id.trim() : null;
  const draft: MealPlanRecipeDraft = {
    name: raw.name.trim(),
    servings,
    ingredients,
    steps,
    tags,
    reuse_recipe_id: reuse,
  };
  if (isRecord(raw.dietary) && typeof raw.dietary.safe === 'boolean') {
    draft.dietary = {
      safe: raw.dietary.safe,
      ...(Array.isArray(raw.dietary.flags) ? { flags: raw.dietary.flags } : {}),
    };
  }
  return draft;
}

function parseDraftDay(raw: unknown): MealPlanDraftDay | null {
  if (!isRecord(raw) || typeof raw.day !== 'string' || !raw.day.trim()) return null;
  const meals: MealPlanDraftMeal[] = [];
  for (const m of Array.isArray(raw.meals) ? raw.meals : []) {
    if (!isRecord(m) || typeof m.slot !== 'string' || !m.slot.trim()) continue;
    const recipe = parseRecipeDraftNested(m.recipe);
    if (!recipe) continue;
    meals.push({ slot: m.slot.trim(), recipe });
  }
  if (!meals.length) return null;
  return { day: raw.day.trim(), meals };
}

export function parseMealPlanDraft(raw: unknown): MealPlanDraft | null {
  const body = unwrapPlanBody(raw);
  if (!isRecord(body) || typeof body.week_of !== 'string' || !body.week_of.trim()) return null;
  const days: MealPlanDraftDay[] = [];
  for (const d of Array.isArray(body.days) ? body.days : []) {
    const day = parseDraftDay(d);
    if (day) days.push(day);
  }
  return {
    week_of: body.week_of.trim(),
    days,
    shopping_list: parseShoppingList(body.shopping_list),
    notes: typeof body.notes === 'string' ? body.notes : null,
    ...(typeof body.filtered_allergy === 'number' ? { filtered_allergy: body.filtered_allergy } : {}),
  };
}

export function parsePlanList(body: unknown): MealPlan[] {
  const list =
    isRecord(body) && Array.isArray(body.meal_plans)
      ? body.meal_plans
      : isRecord(body) && Array.isArray(body.plans)
        ? body.plans
        : Array.isArray(body)
          ? body
          : [];
  const out: MealPlan[] = [];
  for (const row of list) {
    const p = parseMealPlan(row);
    if (p) out.push(p);
  }
  return out;
}
