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

/** Parse `req.body` with a Zod schema; throw BodyValidationError on failure. */
export function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body ?? {});
  if (!result.success) {
    const first = result.error.issues[0];
    throw new BodyValidationError(first?.message ?? 'invalid request body');
  }
  return result.data;
}

/** Express helper: run handler with parsed body, map BodyValidationError → 400. */
export function withParsedBody<T>(
  schema: z.ZodType<T>,
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
  })
  .superRefine((val, ctx) => {
    const text = typeof val.text === 'string' ? val.text.trim() : '';
    if (!text && !val.photo) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'a meal needs words or a photo' });
    }
  })
  .transform((val) => ({
    text: typeof val.text === 'string' ? val.text.trim() : '',
    meal: val.meal,
    photo: val.photo,
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
