import { z } from 'zod';

export const createProcessingJobSchema = z.object({
  name: z.string().min(1, 'Name is required').max(255),
  slug: z
    .string()
    .min(1, 'Slug is required')
    .max(255)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens'),
  description: z.string().max(50_000).optional().nullable(),
  ai_profile_id: z.string().uuid().optional().nullable(),
  is_active: z.boolean().optional().default(true),
  config: z
    .object({
      systemPrompt: z.string().max(50_000).optional(),
      promptTemplate: z.string().max(50_000).optional(),
      variables: z
        .array(
          z.object({
            name: z.string().min(1).max(100),
            label: z.string().max(200).optional(),
            description: z.string().max(500).optional(),
            required: z.boolean().optional(),
          }),
        )
        .max(50)
        .optional(),
    })
    .passthrough()
    .optional(),
  calling_application_id: z.string().max(200).optional().nullable(),
  requires_user_credentials: z.boolean().optional(),
});

export const updateProcessingJobSchema = createProcessingJobSchema.partial();

export const executeJobSchema = z.object({
  message: z.string().max(50_000).optional(),
  variables: z.record(z.string(), z.unknown()).optional(),
  ruleSetKey: z.string().max(200).optional(),
  callingApplication: z.string().max(200).optional(),
  promptOverride: z.string().max(50_000).optional().nullable(),
  attachments: z
    .array(
      z.object({
        url: z.string().url().max(500),
        mimeType: z.string().max(200),
        fileName: z.string().max(200),
      }),
    )
    .max(20)
    .optional(),
});

export const applyFormattingSchema = z.object({
  text: z.string().min(1).max(50_000),
  rules: z.array(z.record(z.string(), z.unknown())).max(50).optional(),
});

const batchItemSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(50_000).optional().nullable(),
  slug: z
    .string()
    .max(255)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase alphanumeric with hyphens')
    .optional(),
  config: z
    .object({
      systemPrompt: z.string().max(50_000).optional(),
      promptTemplate: z.string().max(50_000).optional(),
      variables: z
        .array(
          z.object({
            name: z.string().min(1).max(100),
            label: z.string().max(200).optional(),
            description: z.string().max(500).optional(),
            required: z.boolean().optional(),
          }),
        )
        .max(50)
        .optional(),
    })
    .passthrough()
    .optional(),
  ai_profile_id: z.string().uuid().optional().nullable(),
  is_active: z.boolean().optional(),
  group_id: z.string().uuid().optional().nullable(),
});

export const batchUpdateSchema = z.object({
  updates: z.array(batchItemSchema).min(1).max(100),
});

export const datasourceUploadSchema = z.object({
  rows: z.array(z.record(z.string(), z.unknown())).max(1000),
  namePrefix: z.string().max(200).optional(),
  maxChunkBytes: z.number().int().positive().optional(),
  callingApplication: z.string().max(200).optional(),
});
