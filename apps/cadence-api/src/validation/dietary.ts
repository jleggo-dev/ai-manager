/**
 * Zod schema for GET/POST /nutrition/dietary-profile (Req 5 WS5).
 * Fail closed via parseBody — allergies / dislikes are string lists.
 */
import { z } from 'zod';

const tagListSchema = z.array(z.string().trim().min(1)).max(40);

export const dietaryProfileBodySchema = z
  .object({
    allergies: tagListSchema.default([]),
    diet: z
      .string()
      .trim()
      .min(1)
      .nullable()
      .optional()
      .transform((v) => (v === undefined ? null : v)),
    dislikes: tagListSchema.default([]),
    notes: z
      .string()
      .trim()
      .max(500)
      .nullable()
      .optional()
      .transform((v) => (v === undefined ? null : v)),
  })
  .strict();
