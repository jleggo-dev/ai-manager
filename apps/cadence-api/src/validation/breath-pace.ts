import { z } from 'zod';
import { MAX_BREATH_PACE, MIN_BREATH_PACE } from '@cadence/shared';

const RANGE = `pace must be ${MIN_BREATH_PACE}..${MAX_BREATH_PACE} seconds a count`;

/**
 * The person's breath pace, seconds per count. Only the person's own range is checked here: the
 * per-pattern safety caps depend on what is being played, so `clampBreathPace` applies them when a
 * pattern plays rather than narrowing what the person is allowed to have set.
 */
export const breathPaceBodySchema = z.object({
  pace: z.number({ message: RANGE }).min(MIN_BREATH_PACE, { message: RANGE }).max(MAX_BREATH_PACE, { message: RANGE }),
});
