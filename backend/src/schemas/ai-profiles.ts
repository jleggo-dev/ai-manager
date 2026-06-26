import { z } from 'zod';

export const createAiProfileSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  provider_id: z.string().uuid('Must be a valid provider ID'),
  external_ai_id: z.string().min(1, 'External AI ID is required').max(200),
  description: z.string().max(50_000).optional().nullable(),
  is_active: z.boolean().optional().default(true),
  profile_type: z.enum(['agent', 'model']).optional(),
  mode: z.enum(['completion', 'chat']).optional(),
  runtime_options: z.record(z.string(), z.unknown()).optional().nullable(),
  failover_provider_id: z.string().uuid().optional().nullable(),
  failover_external_ai_id: z.string().max(200).optional().nullable(),
  failover_runtime_options: z.record(z.string(), z.unknown()).optional().nullable(),
});

export const updateAiProfileSchema = createAiProfileSchema.partial().extend({
  is_default: z.boolean().optional(),
  system_prompt: z.string().max(50_000).optional().nullable(),
});
