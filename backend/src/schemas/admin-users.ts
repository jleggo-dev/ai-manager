import { z } from 'zod';
import { ACCOUNT_STATUSES } from '../constants/account-status.ts';

export const updateUserStatusSchema = z.object({
  status: z.enum(ACCOUNT_STATUSES),
});

export type UpdateUserStatusBody = z.infer<typeof updateUserStatusSchema>;
