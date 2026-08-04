/**
 * Shared Zod helpers for Cadence API route + LLM-JSON boundaries (API-P2 pilot).
 * Fail closed: invalid input → 400 with a stable error string; never throw ZodError raw.
 */
import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { z } from 'zod';

export class BodyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BodyValidationError';
  }
}

/**
 * Parse `req.body` with a Zod schema; throw BodyValidationError on failure.
 * Accepts ZodEffects (refine/transform) via structural safeParse — not only ZodType<T>.
 */
export function parseBody<T>(
  schema: { safeParse: (data: unknown) => z.SafeParseReturnType<unknown, T> },
  body: unknown,
): T {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    const first = result.error.issues[0];
    throw new BodyValidationError(first?.message ?? 'invalid request body');
  }
  return result.data;
}

/** Express helper: run handler with parsed body, map BodyValidationError → 400. */
export function withParsedBody<T>(
  schema: { safeParse: (data: unknown) => z.SafeParseReturnType<unknown, T> },
  handler: (req: Request, res: Response, body: T) => Promise<void>,
) {
  return async (req: Request, res: Response) => {
    try {
      const body = parseBody(schema, req.body);
      await handler(req, res, body);
    } catch (err) {
      if (err instanceof BodyValidationError) {
        return void res.status(400).json({ error: err.message });
      }
      throw err;
    }
  };
}

export const mealKindSchema = z.enum(['breakfast', 'lunch', 'dinner', 'snack', 'drink', 'other']);

export const logMealBodySchema = z
  .object({
    text: z.string().optional(),
    meal: mealKindSchema.optional(),
    photo: z
      .string()
      .refine((s) => s.startsWith('data:image/'), { message: 'photo must be a data:image URL' })
      .optional(),
    /** Deterministic log of a saved food (Req 5) — no AI when set. */
    food_id: z.string().uuid({ message: 'food_id must be a uuid' }).optional(),
    /** Deterministic log of N servings of a saved recipe (Req 5 WS3) — no AI when set. */
    recipe_id: z.string().uuid({ message: 'recipe_id must be a uuid' }).optional(),
    serving_index: z.number().int().min(0).optional(),
    /** MFP "Number of Servings" multiplier; default 1. */
    quantity: z.number().positive().optional(),
    /** Alias for recipe quantity (accepted by Food-tab clients). */
    servings: z.number().positive().optional(),
    /** A plate — N saved-food items composed into one meal (design 2D). */
    items: z
      .array(
        z.object({
          food_id: z.string().uuid({ message: 'items[].food_id must be a uuid' }),
          serving_index: z.number().int().min(0).optional(),
          quantity: z.number().positive().optional(),
        }),
      )
      .min(1)
      .max(20)
      .optional(),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
      .optional(),
  })
  .superRefine((val, ctx) => {
    if (val.food_id && val.recipe_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'food_id and recipe_id are mutually exclusive',
      });
    }
    const text = typeof val.text === 'string' ? val.text.trim() : '';
    if (!text && !val.photo && !val.food_id && !val.recipe_id && !val.items?.length) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'a meal needs words, a photo, a food_id, a recipe_id, or items',
      });
    }
  })
  .transform((val) => ({
    text: typeof val.text === 'string' ? val.text.trim() : '',
    meal: val.meal,
    photo: val.photo,
    food_id: val.food_id,
    recipe_id: val.recipe_id,
    serving_index: val.serving_index,
    quantity: val.quantity ?? val.servings,
    items: val.items,
    date: val.date,
  }));

export const macroTargetsBodySchema = z
  .object({
    kcal: z.number().positive().optional(),
    protein_g: z.number().positive().optional(),
    carbs_g: z.number().positive().optional(),
    fat_g: z.number().positive().optional(),
  })
  .passthrough();

/* ── Plan / review / progress route bodies (API-P2 expand) ─────────────────── */

export const replanSteerBodySchema = z
  .object({
    steer: z.string().optional(),
  })
  .transform((val) => {
    const steer = typeof val.steer === 'string' ? val.steer.trim().slice(0, 500) : '';
    return { steer: steer || undefined };
  });

export const occurrenceLogBodySchema = z
  .object({
    text: z.string({ message: 'text required' }),
  })
  .superRefine((val, ctx) => {
    if (!val.text.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'text required' });
    }
  })
  .transform((val) => ({ text: val.text.trim() }));

export const adhocLogBodySchema = z
  .object({
    text: z.string({ message: 'text required' }),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
      .optional(),
  })
  .superRefine((val, ctx) => {
    if (!val.text.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'text required' });
    }
  })
  .transform((val) => ({ text: val.text.trim(), date: val.date }));

/** "Log something you did" against a planned activity — text is OPTIONAL (defaults server-side to
 *  "Did {title}"); the activity is named by the path param, so the body only carries the optional
 *  free-text note + backdate. */
export const didLogBodySchema = z
  .object({
    text: z.string().optional(),
    date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'date must be YYYY-MM-DD' })
      .optional(),
  })
  .transform((val) => ({ text: typeof val.text === 'string' ? val.text.trim() : '', date: val.date }));

export const weighInBodySchema = z
  .object({
    weight: z.coerce.number({ message: 'weight (number) and unit (kg|lb) required' }),
    unit: z.enum(['kg', 'lb'], { message: 'weight (number) and unit (kg|lb) required' }),
  })
  .superRefine((val, ctx) => {
    if (!Number.isFinite(val.weight) || val.weight <= 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'weight (number) and unit (kg|lb) required',
      });
    }
  });

export const occurrenceStatusBodySchema = z.object({
  status: z.enum(['pending', 'done', 'skipped'], {
    message: 'status must be pending|done|skipped',
  }),
});

export const episodeEnterBodySchema = z.object({
  type: z.enum(['travel', 'illness', 'injury', 'recovery', 'custom'], {
    message: 'type must be travel|illness|injury|recovery|custom',
  }),
  days: z.coerce.number().int().min(1).max(60).optional(),
  end: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, { message: 'end must be YYYY-MM-DD' })
    .optional(),
  tone: z.enum(['gentle', 'supportive']).optional(),
  /**
   * What they actually have with them — a hotel gym's dumbbells, a resistance band, nothing at
   * all. `enterEpisode` has always accepted this and the route dropped it, so every detour was
   * drafted against an EMPTY equipment list: the coach was told you had nothing.
   *
   * This is not a nicety. A detour exists to preserve the habits that CAN be preserved when the
   * schedule is thrown out, and the coach cannot work out which those are without knowing the
   * schedule and the equipment. Name only — no ids, no wear, nothing that would let a client
   * mutate the real equipment list through this door.
   */
  available_equipment: z
    .array(z.object({ name: z.string().min(1).max(60) }))
    .max(20)
    .optional(),
});

export const progressEventBodySchema = z
  .object({
    label: z.string({ message: 'label required' }),
    goal_id: z.string().nullable().optional(),
  })
  .superRefine((val, ctx) => {
    if (!val.label.trim()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'label required' });
    }
  })
  .transform((val) => ({
    label: val.label.trim().slice(0, 120),
    goal_id: typeof val.goal_id === 'string' ? val.goal_id : null,
  }));

export const goalAreaSchema = z.enum(['movement', 'nourishment', 'mind', 'practice'], {
  message: 'bad area',
});
export const goalTypeSchema = z.enum(['milestone', 'target', 'recurring'], { message: 'bad type' });
export const equipmentCategorySchema = z.enum(
  ['footwear', 'cardio', 'strength', 'accessory', 'reading', 'practice', 'craft', 'study', 'other'],
  { message: 'bad category' },
);

export const patchGoalBodySchema = z
  .object({
    title: z.string().optional(),
    area: goalAreaSchema.optional(),
    type: goalTypeSchema.optional(),
    measure: z.unknown().optional(),
    timeframe: z.unknown().optional(),
    milestones: z.unknown().optional(),
    plan_mode: z.enum(['coach', 'deterministic']).optional(),
  })
  .passthrough();

export const createGoalBodySchema = z.object({
  title: z.string().min(1, { message: 'title, valid area, valid type required' }),
  area: goalAreaSchema,
  type: goalTypeSchema,
  measure: z.unknown().optional(),
  confirm: z.boolean().optional(),
});

export const patchEquipmentBodySchema = z
  .object({
    name: z.string().optional(),
    category: equipmentCategorySchema.optional(),
  })
  .passthrough();

export const createEquipmentBodySchema = z.object({
  name: z.string().min(1, { message: 'name + valid category required' }),
  category: equipmentCategorySchema,
});

export const patchProfileBodySchema = z.object({
  name: z.string({ message: 'name (string) required' }),
});

const constraintSchema = z.object({
  id: z.string().optional(),
  label: z.unknown().optional(),
  kind: z.unknown().optional(),
  plan_around: z.unknown().optional(),
});

export const patchBaselineBodySchema = z
  .object({
    constraints: z.array(constraintSchema).optional(),
  })
  .passthrough()
  .transform((val) => {
    if (!Array.isArray(val.constraints)) return val;
    return {
      ...val,
      constraints: val.constraints.map((c) => ({
        id: typeof c.id === 'string' && c.id ? c.id : randomUUID(),
        label: String(c.label ?? ''),
        kind: c.kind === 'physical' || c.kind === 'life' || c.kind === 'other' ? c.kind : 'other',
        plan_around: !!c.plan_around,
      })),
    };
  });
