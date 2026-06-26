import { z } from 'zod';

export const runSlotSchema = z.object({
  slot: z.object({
    type: z.string().max(100),
    profileId: z.string().uuid().optional().nullable(),
    providerId: z.string().uuid().optional().nullable(),
    externalAiId: z.string().max(200).optional().nullable(),
    runtimeOptions: z.record(z.string(), z.unknown()).optional(),
  }),
  prompt: z.string().min(1).max(50_000),
  formattingRules: z.array(z.record(z.string(), z.unknown())).optional(),
  attachments: z.array(z.record(z.string(), z.unknown())).max(20).optional(),
  variables: z.record(z.string(), z.unknown()).optional(),
  slotIndex: z.number().int().min(0).max(100).optional(),
  callingApplication: z.string().max(200).optional(),
});
