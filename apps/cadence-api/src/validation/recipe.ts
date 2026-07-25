/**
 * Zod schemas for Req 5 recipe CRUD + from-chat (WS3). Fail closed via parseBody.
 */
import { z } from 'zod';

const macrosSchema = z
  .object({
    kcal: z.number().finite().optional(),
    protein_g: z.number().finite().optional(),
    carbs_g: z.number().finite().optional(),
    fat_g: z.number().finite().optional(),
    source: z.enum(['ai', 'user']).optional(),
  })
  .strict();

const ingredientSchema = z.object({
  food_id: z.string().uuid({ message: 'food_id must be a uuid' }).optional(),
  name: z.string().trim().min(1, { message: 'ingredient name required' }),
  qty: z.union([z.number().positive(), z.string().trim().min(1)]),
  unit: z.string().trim().min(1).optional(),
  est: macrosSchema.optional(),
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
