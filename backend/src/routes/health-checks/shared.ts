/**
 * Shared Zod schemas and helpers for health-check route modules.
 */

import { Request, Response } from 'express';
import { z } from 'zod';

export const createProviderKeySchema = z.object({
  provider_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  api_key: z.string().min(1),
  is_active: z.boolean().optional(),
});

export const updateProviderKeySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  api_key: z.string().min(1).optional(),
  is_active: z.boolean().optional(),
});

export const createProfileSchema = z.object({
  provider_id: z.string().uuid(),
  hc_provider_key_id: z.string().uuid(),
  external_ai_id: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  mode: z.enum(['completion', 'chat']).optional(),
  profile_type: z.enum(['agent', 'model']).optional(),
  runtime_options: z.record(z.string(), z.unknown()).optional(),
  is_active: z.boolean().optional(),
});

export const updateProfileSchema = z.object({
  external_ai_id: z.string().min(1).max(200).optional(),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  mode: z.enum(['completion', 'chat']).optional(),
  profile_type: z.enum(['agent', 'model']).optional(),
  runtime_options: z.record(z.string(), z.unknown()).optional(),
  is_active: z.boolean().optional(),
});

export const createCheckSchema = z.object({
  health_check_profile_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  test_message: z.string().min(1).max(2000).optional(),
  cadence_minutes: z.number().int().min(1).max(1440).optional(),
  outage_cadence_minutes: z.number().int().min(1).max(1440).optional(),
  is_active: z.boolean().optional(),
});

export const updateCheckSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  test_message: z.string().min(1).max(2000).optional(),
  cadence_minutes: z.number().int().min(1).max(1440).optional(),
  outage_cadence_minutes: z.number().int().min(1).max(1440).optional(),
  is_active: z.boolean().optional(),
});

const VALID_STATUSES = new Set(['pass', 'fail', 'timeout', 'error']);

export const runQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: z
    .string()
    .optional()
    .transform((v) => {
      if (!v) return undefined;
      return v
        .split(',')
        .filter((s) => VALID_STATUSES.has(s))
        .slice(0, 4);
    }),
  from: z
    .string()
    .datetime({ offset: true })
    .optional()
    .or(
      z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    ),
  to: z
    .string()
    .datetime({ offset: true })
    .optional()
    .or(
      z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    ),
});

const uuidParam = z.string().uuid();

export function validateUuidParam(req: Request, res: Response): string | null {
  const result = uuidParam.safeParse(req.params.id);
  if (!result.success) {
    res.status(400).json({ error: 'Invalid ID format' });
    return null;
  }
  return result.data;
}

export async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

export function logHealthCheckError(err: unknown): void {
  console.error('[health-checks]', err);
}
