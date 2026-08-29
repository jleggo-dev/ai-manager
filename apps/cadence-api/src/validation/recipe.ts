/**
 * Zod schemas for Req 5 recipe CRUD + from-chat (WS3). Fail closed via parseBody.
 */
import { z } from 'zod';

/**
 * All 12 macro/micro keys `@cadence/shared`'s `Macros` carries — not just the four macros.
 *
 * This was narrower once (`kcal`/`protein_g`/`carbs_g`/`fat_g` only, `.strict()`), which meant a
 * recipe draft this API itself returned — `recipe-macros.ts`'s `toMacros` has carried all 12 keys
 * since MP26 — was REJECTED the moment a client posted it back to save: "Unrecognized key" on the
 * very first ingredient carrying iron or calcium. `.strict()` stays (a typo'd key should fail
 * loudly, not silently vanish); the fix is that every key `toMacros` can produce is named here.
 */
const macrosSchema = z
  .object({
    kcal: z.number().finite().optional(),
    protein_g: z.number().finite().optional(),
    carbs_g: z.number().finite().optional(),
    fat_g: z.number().finite().optional(),
    fiber_g: z.number().finite().optional(),
    sodium_mg: z.number().finite().optional(),
    iron_mg: z.number().finite().optional(),
    zinc_mg: z.number().finite().optional(),
    vitamin_c_mg: z.number().finite().optional(),
    calcium_mg: z.number().finite().optional(),
    potassium_mg: z.number().finite().optional(),
    vitamin_b12_ug: z.number().finite().optional(),
    source: z.enum(['ai', 'user']).optional(),
  })
  .strict();

const ingredientSchema = z.object({
  food_id: z.string().uuid({ message: 'food_id must be a uuid' }).optional(),
  name: z.string().trim().min(1, { message: 'ingredient name required' }),
  qty: z.union([z.number().positive(), z.string().trim().min(1)]),
  unit: z.string().trim().min(1).optional(),
  est: macrosSchema.optional(),
  /**
   * MP10: the explicit "this ingredient has no numbers" signal, round-tripped from a draft this
   * API returned. `reason` is shown to a person eventually, not just logged — capped well short of
   * `est`/`name`'s own limits so one bad ingredient can't bloat the request.
   */
  unresolved: z.literal(true).optional(),
  reason: z.string().trim().max(300).optional(),
});

export const recipeSourceSchema = z.enum(['user', 'ai', 'ai_from_fridge_photo', 'ai_from_chat'], {
  message: 'bad recipe source',
});

export const createRecipeBodySchema = z.object({
  name: z.string().trim().min(1, { message: 'name required' }).max(120),
  source: recipeSourceSchema.optional(),
  servings: z.number().int().positive({ message: 'servings must be a positive integer' }),
  ingredients: z.array(ingredientSchema).min(1, { message: 'at least one ingredient required' }).max(40),
  steps: z.array(z.string().trim().min(1)).max(30).optional(),
  tags: z.array(z.string().trim().min(1)).max(20).optional(),
  saved: z.boolean().optional(),
});

export const patchRecipeBodySchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    servings: z.number().int().positive().optional(),
    ingredients: z.array(ingredientSchema).min(1).max(40).optional(),
    steps: z.array(z.string().trim().min(1)).max(30).optional(),
    tags: z.array(z.string().trim().min(1)).max(20).optional(),
    saved: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'nothing to update' });

export const fromChatBodySchema = z.object({
  text: z.string().trim().min(1, { message: 'text required' }).max(2000),
});

const photoDataUrlSchema = z
  .string()
  .refine((s) => s.startsWith('data:image/'), { message: 'photo must be a data:image URL' });

/** POST /nutrition/recipes/parse-fridge — fridge/pantry photo → ingredient list (unsaved). */
export const parseFridgeBodySchema = z
  .object({
    photo: photoDataUrlSchema,
    hint: z.string().trim().max(200).optional(),
  })
  .transform((val) => ({
    photo: val.photo,
    hint: val.hint || undefined,
  }));

const fridgeIngredientSchema = z.object({
  name: z.string().trim().min(1, { message: 'ingredient name required' }).max(80),
  qty: z.number().positive().optional(),
  unit: z.string().trim().min(1).max(24).optional(),
});

/** POST /nutrition/recipes/generate — reviewed ingredients → recipe draft ideas (unsaved). */
export const generateFromIngredientsBodySchema = z.object({
  ingredients: z.array(fridgeIngredientSchema).min(1, { message: 'at least one ingredient required' }).max(40),
  meal_hint: z.string().trim().max(200).optional(),
});
