import { z } from 'zod';
import { NUDGE_TIERS } from '@cadence/shared';

/**
 * Notification-preference bodies.
 *
 * Every field is optional and the route applies only what was sent, because Settings has four
 * independent controls and a PUT that carried the whole object would let a stale tab silently
 * revert someone's quiet hours to what they were when the sheet opened.
 *
 * Quiet minutes are 0..1439 — minutes past local midnight, matching the DB's own check constraint
 * (0026). 1440 is not "midnight tomorrow", it is out of range: the window wraps by comparing
 * start against end, so a valid day never needs a 1440th minute.
 */
export const notificationPrefsBodySchema = z
  .object({
    enabled: z.boolean().optional(),
    tier: z.enum(NUDGE_TIERS, { message: 'tier must be few|moderate|lots' }).optional(),
    quietStartMin: z
      .number()
      .int()
      .min(0, { message: 'quietStartMin must be 0..1439' })
      .max(1439, { message: 'quietStartMin must be 0..1439' })
      .optional(),
    quietEndMin: z
      .number()
      .int()
      .min(0, { message: 'quietEndMin must be 0..1439' })
      .max(1439, { message: 'quietEndMin must be 0..1439' })
      .optional(),
  })
  .strict({ message: 'unknown field' });

export type NotificationPrefsBody = z.infer<typeof notificationPrefsBodySchema>;
