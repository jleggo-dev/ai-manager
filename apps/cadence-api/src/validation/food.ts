/**
 * Zod schemas for Req 5 food CRUD routes (WS1). Fail closed via parseBody.
 */
import { z } from 'zod';

const foodNutrientsSchema = z
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
  })
  .strict();

const foodServingSchema = z.object({
  label: z.string().trim().min(1, { message: 'serving label required' }),
  unit: z.string().trim().min(1, { message: 'serving unit required' }),
  amount_g: z.number().positive({ message: 'serving amount_g must be > 0' }),
});

export const foodSourceSchema = z.enum(['llm', 'label_photo', 'manual', 'chat', 'usda', 'off'], {
  message: 'bad food source',
});
export const foodBaseUnitSchema = z.enum(['g', 'ml', 'item'], { message: 'bad base_unit' });
export const foodVisibilitySchema = z.enum(['private', 'shared'], { message: 'bad visibility' });

export const createFoodBodySchema = z
  .object({
    name: z.string().trim().min(1, { message: 'name required' }),
    brand: z.string().trim().nullable().optional(),
    source: foodSourceSchema,
    off_id: z.string().trim().nullable().optional(),
    fdc_id: z.number().int().positive().nullable().optional(),
    base_unit: foodBaseUnitSchema,
    macros_per_base: foodNutrientsSchema,
    servings: z.array(foodServingSchema).min(1, { message: 'at least one serving required' }),
    default_serving: z.number().int().min(0).optional(),
    confidence: z.number().min(0).max(1).nullable().optional(),
    photo_ref: z.string().trim().nullable().optional(),
    visibility: foodVisibilitySchema.optional(),
  })
  .superRefine((val, ctx) => {
    const idx = val.default_serving ?? 0;
    if (idx >= val.servings.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'default_serving must be a valid servings index',
      });
    }
  });

export const patchFoodBodySchema = z
  .object({
    name: z.string().trim().min(1).optional(),
    brand: z.string().trim().nullable().optional(),
    macros_per_base: foodNutrientsSchema.optional(),
    servings: z.array(foodServingSchema).min(1).optional(),
    default_serving: z.number().int().min(0).optional(),
    confidence: z.number().min(0).max(1).nullable().optional(),
    photo_ref: z.string().trim().nullable().optional(),
    visibility: foodVisibilitySchema.optional(),
  })
  .superRefine((val, ctx) => {
    if (val.servings && val.default_serving !== undefined && val.default_serving >= val.servings.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'default_serving must be a valid servings index',
      });
    }
  });

const photoDataUrlSchema = z
  .string()
  .refine((s) => s.startsWith('data:image/'), { message: 'photo must be a data:image URL' });

/** POST /nutrition/foods/parse-label — Nutrition Facts panel photo → unsaved candidate. */
export const parseLabelBodySchema = z
  .object({
    photo: photoDataUrlSchema,
    hint: z.string().trim().max(200).optional(),
    name: z.string().trim().min(1).max(120).optional(),
    brand: z.string().trim().max(120).nullable().optional(),
  })
  .transform((val) => ({
    photo: val.photo,
    hint: val.hint || undefined,
    name: val.name || undefined,
    brand: val.brand === undefined ? undefined : val.brand,
  }));

/** POST /nutrition/foods/estimate — describe-a-food text → unsaved candidate. */
export const estimateFoodBodySchema = z
  .object({
    text: z.string().trim().min(1, { message: 'text required' }).max(500),
  })
  .transform((val) => ({ text: val.text }));

/** POST /nutrition/foods/identify — front-of-pack photo → name + brand. */
export const identifyFoodBodySchema = z
  .object({
    photo: photoDataUrlSchema,
    hint: z.string().trim().max(200).optional(),
  })
  .transform((val) => ({
    photo: val.photo,
    hint: val.hint || undefined,
  }));

/**
 * POST /nutrition/foods/import-off — browser-mapped OFF product → shared Food upsert.
 * source/visibility are forced server-side (off / shared); client must not invent them.
 */
export const importOffFoodBodySchema = z
  .object({
    name: z.string().trim().min(1, { message: 'name required' }).max(200),
    brand: z.string().trim().max(120).nullable().optional(),
    off_id: z
      .string()
      .trim()
      .regex(/^\d{8,14}$/, { message: 'off_id must be an 8–14 digit barcode' }),
    base_unit: foodBaseUnitSchema,
    macros_per_base: foodNutrientsSchema,
    servings: z.array(foodServingSchema).min(1, { message: 'at least one serving required' }),
    default_serving: z.number().int().min(0).optional(),
    confidence: z.number().min(0).max(1).nullable().optional(),
    photo_ref: z.string().trim().nullable().optional(),
  })
  .superRefine((val, ctx) => {
    const idx = val.default_serving ?? 0;
    if (idx >= val.servings.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'default_serving must be a valid servings index',
      });
    }
    const macros = val.macros_per_base;
    if (
      macros.kcal === undefined &&
      macros.protein_g === undefined &&
      macros.carbs_g === undefined &&
      macros.fat_g === undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'macros_per_base needs at least one macro',
      });
    }
  });

/** POST /nutrition/foods/resolve — deterministic rank + preselect (WS-R); no AI. */
export const resolveFoodBodySchema = z
  .object({
    text: z.string().max(500).optional(),
    photo: photoDataUrlSchema.optional(),
  })
  .superRefine((val, ctx) => {
    const text = typeof val.text === 'string' ? val.text.trim() : '';
    if (!text && !val.photo) {
      // Empty resolve is valid — returns recents/frequents (Food-tab empty-search).
      return;
    }
    if (val.photo && !val.photo.startsWith('data:image/')) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'photo must be a data:image URL' });
    }
  })
  .transform((val) => ({
    text: typeof val.text === 'string' ? val.text.trim() : '',
    photo: val.photo,
  }));

/** POST /nutrition/foods/usda/import — cache a USDA food by FDC id. */
export const importUsdaBodySchema = z
  .object({
    fdc_id: z.number().int().positive({ message: 'fdc_id must be a positive integer' }),
  })
  .transform((val) => ({ fdc_id: val.fdc_id }));
