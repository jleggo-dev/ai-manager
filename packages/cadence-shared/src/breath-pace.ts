import {
  MAX_HOLD_SECONDS,
  MAX_SESSION_SECONDS,
  breathPhaseKind,
  clampCycles,
  cycleSeconds,
  type BreathPattern,
} from './breathing.ts';

/* ════════════════════════════════════════════════════════════════
   Breath pace — how long one count lasts for this person
   ════════════════════════════════════════════════════════════════ */

/**
 * The coach prescribes the practice (pattern and rounds); the person sets how long a count lasts,
 * because that is their lungs and not a choice of practice (owner, 2026-11-06, REQ9 §4.1).
 *
 * Pace is **seconds per count**. The count itself never changes: box is still 4-3-2-1 at any pace,
 * each number simply lasts longer, so every line of copy that says "in for four" stays true and a
 * pattern's proportions survive. One number per person covers all nine patterns.
 *
 * The safety caps in `breathing.ts` are enforced on what the person actually experiences, so they
 * bound the pace here: a slower count cannot stretch a hold or a session past its cap. Pure and
 * total like the rest of the breath maths — bad input degrades to the default.
 */

export const DEFAULT_BREATH_PACE = 1;
export const MIN_BREATH_PACE = 0.75;
export const MAX_BREATH_PACE = 2;

/** Sharpen is quick on purpose and capped hardest, so it plays at its authored pace, always. */
export function canSetBreathPace(pattern: BreathPattern): boolean {
  return !pattern.gated;
}

/** The quickest this pattern may play. */
export function breathPaceFloor(pattern: BreathPattern): number {
  return canSetBreathPace(pattern) ? MIN_BREATH_PACE : DEFAULT_BREATH_PACE;
}

/**
 * The slowest this pattern may play: the person's range, narrowed so the longest hold stays within
 * `MAX_HOLD_SECONDS` and the whole run within `MAX_SESSION_SECONDS`. Never below the default — a
 * run the coach prescribed at the cap has to stay playable.
 */
export function breathPaceCeiling(pattern: BreathPattern, cycles: number): number {
  if (!canSetBreathPace(pattern)) return DEFAULT_BREATH_PACE;
  const holds = pattern.phases.filter((p) => breathPhaseKind(p.label) === 'hold').map((p) => p.seconds);
  const longestHold = Math.max(0, ...holds);
  const byHold = longestHold > 0 ? MAX_HOLD_SECONDS / longestHold : MAX_BREATH_PACE;
  const run = cycleSeconds(pattern) * clampCycles(pattern, cycles);
  const bySession = run > 0 ? MAX_SESSION_SECONDS / run : MAX_BREATH_PACE;
  return Math.max(DEFAULT_BREATH_PACE, Math.min(MAX_BREATH_PACE, byHold, bySession));
}

/** The pace this pattern actually plays at, given what the person last set. */
export function clampBreathPace(pattern: BreathPattern, cycles: number, pace: number | null | undefined): number {
  const asked = typeof pace === 'number' && Number.isFinite(pace) ? pace : DEFAULT_BREATH_PACE;
  return Math.min(breathPaceCeiling(pattern, cycles), Math.max(breathPaceFloor(pattern), asked));
}
