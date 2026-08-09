import { z } from 'zod';
import { CHECKIN_ADJUSTMENTS, COACH_FACE_IDS, FELT_STATE_CODES, RPE_CODES, SKIP_REASON_CODES } from '@cadence/shared';

/**
 * Body schemas for the coach-moment endpoints. Enums come from @cadence/shared rather than being
 * restated here, so the DB CHECK, the API boundary and the chips the client renders can only ever
 * drift together — adding a chip without widening the constraint is the failure this prevents.
 */

/** `face_id: null` is a legitimate choice — "no face", back to the brand mark. */
export const coachFaceBodySchema = z.object({
  face_id: z.enum(COACH_FACE_IDS).nullable(),
});

/**
 * One answer, matched to its question. Refined rather than a bare object because the DB enforces
 * the same pairing — a movement session carrying a felt_state would fail the CHECK at 500 instead
 * of telling the caller what it did wrong at 400.
 */
export const sessionFeedbackBodySchema = z
  .object({
    occurrence_id: z.string().uuid().nullish(),
    kind: z.enum(['movement', 'mind']),
    rpe: z.enum(RPE_CODES).nullish(),
    felt_state: z.enum(FELT_STATE_CODES).nullish(),
    reason_code: z.enum(SKIP_REASON_CODES).nullish(),
  })
  .refine((b) => (b.kind === 'mind' ? !b.rpe && !b.reason_code : !b.felt_state), {
    message: 'movement sessions take rpe/reason_code; mind sessions take felt_state',
  })
  .refine((b) => !!(b.rpe || b.felt_state || b.reason_code), { message: 'an answer is required' });

/** Mood and adjustment are independent and both optional; `dismissed` is the "Not now" tap. */
export const dailyCheckinBodySchema = z
  .object({
    mood: z.number().int().min(1).max(5).nullish(),
    adjustment: z.enum(CHECKIN_ADJUSTMENTS).nullish(),
    dismissed: z.boolean().optional(),
  })
  .refine((b) => b.mood != null || b.adjustment != null || b.dismissed === true, {
    message: 'nothing to record',
  });
