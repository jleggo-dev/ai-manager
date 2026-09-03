/**
 * Req 5 Phase 5 — meal plans + shopping list.
 * Confirm-before-save: generate never persists; POST upserts after user confirm.
 */
import {
  assessDietarySafety,
  type DietarySafetyAssessment,
  type MealPlan,
  type MealPlanDay,
  type MealPlanMeal,
  type ShoppingListItem,
} from '@cadence/shared';
import { runJobBySlug } from '../ai/aim.ts';
import {
  deleteMealPlan,
  getMealPlan,
  getMealPlanByWeek,
  listMealPlans,
  updateMealPlan,
  upsertMealPlan,
} from '../repos/meal-plans.ts';
import { getRecipe, listRecipes } from '../repos/recipes.ts';
import { getFood } from '../repos/foods.ts';
import { getDietaryProfile, getUser } from '../repos/users.ts';
import { logAi } from './ai-log.ts';
import {
  deriveShoppingList,
  formatFridgeForJob,
  parseGenerateMealPlanResult,
  type FridgeLike,
  type MealPlanStructuredRecipe,
} from './meal-plan-parse.ts';
import { createRecipe } from './recipe.ts';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export interface MealPlanRecipeDraft {
  name: string;
  servings: number;
  ingredients: { name: string; qty: number; unit?: string }[];
  steps: string[];
  tags: string[];
  reuse_recipe_id: string | null;
  dietary: DietarySafetyAssessment;
}

export interface MealPlanDraftMeal {
  slot: string;
  recipe: MealPlanRecipeDraft;
}

export interface MealPlanDraftDay {
  day: string;
  meals: MealPlanDraftMeal[];
}

/** Unsaved week plan — UI confirms via POST /nutrition/meal-plans. */
export interface MealPlanDraft {
  week_of: string;
  days: MealPlanDraftDay[];
  shopping_list: ShoppingListItem[];
  notes: string | null;
  filtered_allergy: number;
}

export interface GenerateMealPlanInput {
  week_of: string;
  fridge_ingredients?: FridgeLike[];
  recipe_ids?: string[];
  /** Which meals each day carries — the user's own selection; dinners only by default. */
  slots?: ('breakfast' | 'lunch' | 'dinner')[];
  prefs?: string;
}

const SLOT_ORDER = ['breakfast', 'lunch', 'dinner'] as const;

function dietaryJobVars(profile: Awaited<ReturnType<typeof getDietaryProfile>>): {
  allergies: string;
  diet: string;
  dislikes: string;
} {
  return {
    allergies: (profile?.allergies ?? []).join(', '),
    diet: profile?.diet?.trim() || '',
    dislikes: (profile?.dislikes ?? []).join(', '),
  };
}

function assessStructuredRecipe(
  profile: Awaited<ReturnType<typeof getDietaryProfile>>,
  recipe: MealPlanStructuredRecipe,
): DietarySafetyAssessment {
  return assessDietarySafety(profile, [recipe.name, ...recipe.ingredients.map((i) => i.name)]);
}

async function formatSavedRecipesForJob(userId: string, recipeIds: string[] | undefined): Promise<string> {
  const prefer = new Set((recipeIds ?? []).filter(Boolean));
  const saved = await listRecipes(userId, { savedOnly: true, limit: 30 });
  const picked = prefer.size
    ? saved.filter((r) => prefer.has(r.recipe_id)).concat(saved.filter((r) => !prefer.has(r.recipe_id)))
    : saved;
  return picked
    .slice(0, 20)
    .map((r) => {
      const ings = r.ingredients
        .slice(0, 8)
        .map((i) => i.name)
        .join(', ');
      return `${r.recipe_id}|${r.name}|serves ${r.servings}|${ings}`;
    })
    .join('\n');
}

function toRecipeDraft(recipe: MealPlanStructuredRecipe, dietary: DietarySafetyAssessment): MealPlanRecipeDraft {
  return {
    name: recipe.name,
    servings: recipe.servings,
    ingredients: recipe.ingredients.map((i) => ({
      name: i.name,
      qty: i.qty,
      ...(i.unit ? { unit: i.unit } : {}),
    })),
    steps: recipe.steps,
    tags: recipe.tags,
    reuse_recipe_id: recipe.reuse_recipe_id,
    dietary,
  };
}

/**
 * Prefs / fridge / saved recipes → unsaved week draft + shopping list.
 * Allergen-unsafe slots are dropped (hard safety).
 */
export async function generateMealPlan(userId: string, input: GenerateMealPlanInput): Promise<MealPlanDraft> {
  const week_of = input.week_of.trim();
  if (!ISO_DATE.test(week_of)) throw new Error('week_of must be YYYY-MM-DD');

  // Owner ruling 2026-09-03: the user picks the slots; dinners only unless they asked for more.
  // Fewer slots is also the speed lever — the model writes every recipe, so 7 dinners is a third
  // of the tokens (and the wait) of a 21-meal week.
  const slots = SLOT_ORDER.filter((s) => (input.slots ?? ['dinner']).includes(s));
  const slotList = (slots.length ? slots : ['dinner']).join(', ');
  const fridge = (input.fridge_ingredients ?? [])
    .map((i) => ({
      name: i.name.trim().slice(0, 80),
      ...(typeof i.qty === 'number' && i.qty > 0 ? { qty: i.qty } : {}),
      ...(i.unit?.trim() ? { unit: i.unit.trim().slice(0, 24) } : {}),
    }))
    .filter((i) => i.name);

  const profile = await getDietaryProfile(userId);
  const user = await getUser(userId);
  const targets = user?.macro_targets ? JSON.stringify(user.macro_targets) : '';
  const dietVars = dietaryJobVars(profile);
  const savedRecipes = await formatSavedRecipesForJob(userId, input.recipe_ids);

  let rawOut = '';
  try {
    const res = await runJobBySlug(userId, 'generate-meal-plan', {
      week_of,
      slots: slotList,
      fridge_ingredients: formatFridgeForJob(fridge),
      saved_recipes: savedRecipes,
      allergies: dietVars.allergies,
      diet: dietVars.diet,
      dislikes: dietVars.dislikes,
      targets,
      prefs: (input.prefs ?? '').trim().slice(0, 400),
    });
    rawOut = res.formatted ?? res.raw ?? '';
  } catch (e) {
    console.warn('[meal-plan] generate-meal-plan failed:', e);
    throw e instanceof Error ? e : new Error('generate-meal-plan failed');
  }

  const parsed = parseGenerateMealPlanResult(rawOut);
  const days: MealPlanDraftDay[] = [];
  let filtered_allergy = 0;
  const structuredForShop: MealPlanStructuredRecipe[] = [];

  for (const day of parsed.days) {
    const meals: MealPlanDraftMeal[] = [];
    for (const meal of day.meals) {
      const dietary = assessStructuredRecipe(profile, meal.recipe);
      if (!dietary.safe) {
        filtered_allergy += 1;
        console.info('[meal-plan] dropped allergen-flagged slot:', day.day, meal.slot, meal.recipe.name);
        continue;
      }
      // Validate reuse id belongs to the user; ignore stale ids.
      let reuse = meal.recipe.reuse_recipe_id;
      if (reuse) {
        const owned = await getRecipe(userId, reuse);
        if (!owned) reuse = null;
      }
      const recipe = { ...meal.recipe, reuse_recipe_id: reuse };
      structuredForShop.push(recipe);
      meals.push({ slot: meal.slot, recipe: toRecipeDraft(recipe, dietary) });
    }
    if (meals.length) days.push({ day: day.day, meals });
  }

  let shopping_list = parsed.shopping_list;
  if (shopping_list.length === 0 && structuredForShop.length > 0) {
    shopping_list = deriveShoppingList(structuredForShop, fridge);
  }

  let notes = parsed.notes;
  if (days.length === 0) {
    notes =
      notes ||
      (filtered_allergy > 0
        ? "I couldn't build a week that stays clear of your allergies — tweak prefs or tell me what you can eat."
        : "I couldn't shape a week from that — add a preference or a couple fridge items and I'll try again.");
  }

  void logAi(userId, {
    kind: 'generate_meal_plan',
    input: {
      week_of,
      fridge: fridge.map((i) => i.name),
      slots: slotList,
      prefs: input.prefs ?? null,
    },
    output: { raw: rawOut.slice(0, 2000) },
    meta: { days: days.length, shopping: shopping_list.length, filtered_allergy },
  });

  return { week_of, days, shopping_list, notes, filtered_allergy };
}

/** Confirm payload — dietary on recipes is UI-only and ignored on persist. */
export interface ConfirmMealPlanInput {
  week_of: string;
  days: Array<{
    day: string;
    meals: Array<{
      slot: string;
      recipe: {
        name: string;
        servings: number;
        ingredients: { name: string; qty: number; unit?: string }[];
        steps?: string[];
        tags?: string[];
        reuse_recipe_id?: string | null;
      };
    }>;
  }>;
  shopping_list: ShoppingListItem[];
  notes?: string | null;
}

/**
 * Persist a confirmed draft: create new recipes for slots without reuse_recipe_id,
 * then upsert the meal_plan row (one plan per user/week).
 */
export async function confirmMealPlan(userId: string, input: ConfirmMealPlanInput): Promise<MealPlan> {
  const week_of = input.week_of.trim();
  if (!ISO_DATE.test(week_of)) throw new Error('week_of must be YYYY-MM-DD');
  if (!Array.isArray(input.days) || input.days.length === 0) throw new Error('at least one day required');

  const days: MealPlanDay[] = [];

  for (const day of input.days) {
    if (!ISO_DATE.test(day.day)) throw new Error(`bad day: ${day.day}`);
    const meals: MealPlanMeal[] = [];
    for (const meal of day.meals) {
      const slot = meal.slot.trim().toLowerCase() || 'dinner';
      let recipeId = meal.recipe.reuse_recipe_id ?? null;
      let recipeName = meal.recipe.name;

      if (recipeId) {
        const owned = await getRecipe(userId, recipeId);
        if (!owned) throw new Error(`recipe not found: ${recipeId}`);
        recipeName = owned.name;
      } else {
        const ings = meal.recipe.ingredients;
        if (!ings?.length) throw new Error(`recipe ingredients required for ${meal.recipe.name}`);
        const { recipe } = await createRecipe(userId, {
          name: meal.recipe.name,
          source: 'ai',
          servings: meal.recipe.servings,
          ingredients: ings,
          steps: meal.recipe.steps ?? [],
          tags: meal.recipe.tags ?? [],
          saved: true,
        });
        recipeId = recipe.recipe_id;
        recipeName = recipe.name;
      }

      meals.push({ slot, recipe_id: recipeId!, recipe_name: recipeName });
    }
    if (meals.length) days.push({ day: day.day, meals });
  }

  if (days.length === 0) throw new Error('at least one meal required');

  const shopping_list = (input.shopping_list ?? []).map((i) => ({
    name: i.name.trim().slice(0, 80),
    qty: (i.qty || '1').trim().slice(0, 40),
    category: (i.category || 'other').trim().slice(0, 24),
    checked: i.checked === true,
  }));

  return upsertMealPlan(userId, {
    week_of,
    days,
    shopping_list,
    notes: input.notes?.trim().slice(0, 400) ?? null,
  });
}

export async function listMealPlansForUser(userId: string, limit?: number): Promise<MealPlan[]> {
  return listMealPlans(userId, limit);
}

export async function getMealPlanForUser(userId: string, mealPlanId: string): Promise<MealPlan | null> {
  return getMealPlan(userId, mealPlanId);
}

export async function getMealPlanForWeek(userId: string, weekOf: string): Promise<MealPlan | null> {
  if (!ISO_DATE.test(weekOf)) throw new Error('week_of must be YYYY-MM-DD');
  return getMealPlanByWeek(userId, weekOf);
}

export async function patchMealPlanForUser(
  userId: string,
  mealPlanId: string,
  patch: { days?: MealPlanDay[]; shopping_list?: ShoppingListItem[]; notes?: string | null },
): Promise<MealPlan | null> {
  /**
   * Ownership, over BOTH meal shapes.
   *
   * This used to read `meal.recipe_id` alone. Frame 10a's composed meal carries recipes AND loose
   * foods in `items`, so checking only the legacy field would have let a client plan a meal
   * referencing any recipe or food id in the table — the check would still pass, because the field
   * it read was empty. Ids are deduped first: a week that repeats Tuesday's dinner should not cost
   * a lookup per repeat.
   */
  if (patch.days) {
    const recipeIds = new Set<string>();
    const foodIds = new Set<string>();
    for (const day of patch.days) {
      for (const meal of day.meals) {
        if (meal.recipe_id) recipeIds.add(meal.recipe_id);
        for (const item of meal.items ?? []) {
          (item.kind === 'food' ? foodIds : recipeIds).add(item.id);
        }
      }
    }
    for (const id of recipeIds) {
      if (!(await getRecipe(userId, id))) throw new Error(`recipe not found: ${id}`);
    }
    for (const id of foodIds) {
      if (!(await getFood(userId, id))) throw new Error(`food not found: ${id}`);
    }
  }
  return updateMealPlan(userId, mealPlanId, patch);
}

export async function removeMealPlan(userId: string, mealPlanId: string): Promise<boolean> {
  return deleteMealPlan(userId, mealPlanId);
}
