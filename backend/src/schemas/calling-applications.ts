import { z } from 'zod';

export const createCallingApplicationSchema = z.object({
  id: z.string().max(100).optional(),
  display_name: z.string().min(1).max(200),
});

export const updateCallingApplicationSchema = z.object({
  display_name: z.string().min(1).max(200).optional(),
});
