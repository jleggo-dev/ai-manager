/**
 * Shared Zod helpers for Cadence API route + LLM-JSON boundaries (API-P2 pilot).
 * Fail closed: invalid input → 400 with a stable error string; never throw ZodError raw.
 */
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
