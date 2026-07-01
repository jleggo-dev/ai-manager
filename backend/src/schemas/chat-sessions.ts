import { z } from 'zod';

export const createChatSessionSchema = z.object({
  jobSlug: z.string().max(200).optional(),
  jobId: z.string().uuid().optional().nullable(),
  aiProfileId: z.string().uuid('Must be a valid AI profile ID').optional(),
  workflowSlug: z.string().max(200).optional(),
  workflowId: z.string().uuid().optional().nullable(),
  userId: z.string().min(1, 'userId is required').max(200),
  callingApplication: z.string().max(200).optional(),
  systemPrompt: z.string().max(50_000).optional().nullable(),
});

export const resumeChatSessionSchema = z
  .object({
    sessionId: z.string().uuid().optional(),
    externalChatId: z.string().min(1).max(200).optional(),
    userId: z.string().max(200).optional(),
    callingApplication: z.string().max(200).optional(),
    /* Opt-in: if the Devs.ai remote chat is gone, drop external_chat_id and
       continue with local-history replay instead of failing. Off by default. */
    fallbackToLocal: z.boolean().optional(),
  })
  .refine((data) => Boolean(data.sessionId || data.externalChatId), {
    message: 'Provide sessionId or externalChatId',
  });

export const toolOutputsSchema = z
  .object({
    outputs: z.array(z.record(z.string(), z.unknown())).min(1).max(50),
    systemMessageId: z.string().max(200).optional(),
  })
  .strict();

export const reconnectStreamSchema = z
  .object({
    lastSequence: z.number().int().min(0).optional(),
  })
  .strict();

export const sendMessageSchema = z
  .object({
    message: z.string().min(1).max(50_000).optional(),
    stepKey: z.string().max(200).optional(),
    ruleSetKey: z.string().max(200).optional(),
    variables: z.record(z.string(), z.unknown()).optional(),
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
  })
  .refine((data) => data.message || data.stepKey || data.ruleSetKey, {
    message: 'Provide message, stepKey, or ruleSetKey',
  });
