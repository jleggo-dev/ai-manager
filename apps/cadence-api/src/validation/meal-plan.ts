/**
 * Zod schemas for Req 5 Phase 5 meal-plan CRUD + generate (confirm-before-save).
 */
import { z } from 'zod';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' });

const fridgeIngredientSchema = z.object({
  name: z.string().trim().min(1).max(80),
  qty: z.number().positive().optional(),
  unit: z.string().trim().min(1).max(24).optional(),
});

const shoppingItemSchema = z.object({
  name: z.string().trim().min(1).max(80),
  qty: z.string().trim().min(1).max(40),
  category: z.string().trim().min(1).max(24),
  checked: z.boolean(),
});

const draftIngredientSchema = z.object({
  name: z.string().trim().min(1).max(80),
  qty: z.number().positive(),
  unit: z.string().trim().min(1).max(24).optional(),
});

const dietarySchema = z
  .object({
    safe: z.boolean(),
    flags: z.array(z.unknown()).optional(),
  })
  .passthrough();

const draftRecipeSchema = z.object({
  name: z.string().trim().min(1).max(120),
  servings: z.number().int().positive(),
  ingredients: z.array(draftIngredientSchema).min(1).max(40),
  steps: z.array(z.string().trim().min(1)).max(30).default([]),
  tags: z.array(z.string().trim().min(1)).max(20).default([]),
  reuse_recipe_id: z.string().uuid().nullable().optional(),
  dietary: dietarySchema.optional(),
});

const draftMealSchema = z.object({
  slot: z.string().trim().min(1).max(24),
  recipe: draftRecipeSchema,
});

const draftDaySchema = z.object({
  day: isoDate,
  meals: z.array(draftMealSchema).min(1).max(6),
});

/** POST /nutrition/meal-plans/generate — prefs/fridge → unsaved week draft. */
export const generateMealPlanBodySchema = z.object({
  week_of: isoDate,
  fridge_ingredients: z.array(fridgeIngredientSchema).max(40).optional(),
  recipe_ids: z.array(z.string().uuid()).max(20).optional(),
  meals_per_day: z.number().int().min(2).max(4).optional(),
  prefs: z.string().trim().max(400).optional(),
});

/** POST /nutrition/meal-plans — confirm draft (creates recipes + upserts plan). */
export const confirmMealPlanBodySchema = z.object({
  week_of: isoDate,
  days: z.array(draftDaySchema).min(1).max(7),
  shopping_list: z.array(shoppingItemSchema).max(80),
  notes: z.string().trim().max(400).nullable().optional(),
});

/**
 * One item in a composed meal — frame 10a's *"recipes, food, or both"*.
 *
 * Macros are accepted from the client because they are DENORMALIZED at plan time on purpose (see
 * `meal-plan-items.ts`): a week view that resolved every recipe and food to total seven days would
 * be 28 fetches to paint one screen. They are bounded rather than trusted — a plan is an intention,
 * and nothing here reaches the food log, which does its own arithmetic from its own sources.
 */
const planItemSchema = z.object({
  kind: z.enum(['recipe', 'food']),
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  qty: z.number().positive().max(10_000),
  unit: z.string().trim().max(24).optional(),
  kcal: z.number().min(0).max(10_000).optional(),
  protein_g: z.number().min(0).max(1_000).optional(),
  carbs_g: z.number().min(0).max(1_000).optional(),
  fat_g: z.number().min(0).max(1_000).optional(),
});

/**
 * A meal is EITHER the legacy single recipe or a composed list — never neither.
 *
 * `recipe_id` stops being required so frame 10a can save a meal of loose foods, but it stays
 * accepted: `generate_meal_plan` still emits that shape and every plan saved before 2026-08-21 is
 * in it. The refine is what replaces the old `required` — without it, "neither" would validate and
 * a meal that contains nothing would persist.
 */
const persistedMealSchema = z
  .object({
    slot: z.string().trim().min(1).max(24),
    name: z.string().trim().min(1).max(120).optional(),
    items: z.array(planItemSchema).max(12).optional(),
    recipe_id: z.string().uuid().optional(),
    recipe_name: z.string().trim().min(1).max(120).optional(),
  })
  .refine((m) => !!m.recipe_id || (m.items?.length ?? 0) > 0, {
    message: 'a planned meal needs either a recipe_id or at least one item',
  });

const persistedDaySchema = z.object({
  day: isoDate,
  meals: z.array(persistedMealSchema).min(1).max(6),
});

/** PATCH /nutrition/meal-plans/:id — edit days / shopping checkoffs / notes. */
export const patchMealPlanBodySchema = z
  .object({
    days: z.array(persistedDaySchema).min(1).max(7).optional(),
    shopping_list: z.array(shoppingItemSchema).max(80).optional(),
    notes: z.string().trim().max(400).nullable().optional(),
  })
  .refine((v) => v.days !== undefined || v.shopping_list !== undefined || v.notes !== undefined, {
    message: 'nothing to update',
  });

/** POST /nutrition/recipes/discover — scoped query → unsaved recipe drafts. */
export const discoverRecipeBodySchema = z.object({
  query: z.string().trim().min(1, { message: 'query required' }).max(200),
});
