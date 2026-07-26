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

const persistedMealSchema = z.object({
  slot: z.string().trim().min(1).max(24),
  recipe_id: z.string().uuid(),
  recipe_name: z.string().trim().min(1).max(120).optional(),
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
