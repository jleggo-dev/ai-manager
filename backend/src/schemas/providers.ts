import { z } from 'zod';

export const createProviderSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  type: z.enum(['devs-ai', 'google-gemini'], { message: 'Type must be one of: devs-ai, google-gemini' }),
  base_url: z.string().url('Must be a valid URL').max(500),
  api_key: z.string().max(500).optional().nullable(),
  is_active: z.boolean().optional().default(true),
  request_timeout_ms: z.number().int().positive().optional().nullable(),
});

export const updateProviderSchema = createProviderSchema.partial();
