/**
 * Pure Resolve types + pre-select helper (no DB). Kept separate so unit tests
 * don't load the postgres client / env.
 */

import type { DietarySafetyAssessment } from '@cadence/shared';

export type ResolveCandidateKind = 'food' | 'recipe' | 'new';

/** How the "new" escape hatch should kick off capture (WS2). */
export type ResolveCapturePath = 'estimate' | 'parse-label';

export interface ResolveInput {
  /** Typed text, a coach turn fragment, or a short description. */
  text: string;
  /**
   * Optional Nutrition Facts / package photo (data:image URL).
   * v1 does not vision-resolve; presence steers the "new" capture hook to parse-label.
   */
  photo?: string;
}

export interface ResolveCaptureHint {
  path: ResolveCapturePath;
  /** Text to feed estimate-food when path is 'estimate'. */
  text?: string;
}

export interface ResolveCandidate {
  kind: ResolveCandidateKind;
  /** Higher is better; scores are deterministic from match + usage. */
  score: number;
  label: string;
  food_id?: string;
  recipe_id?: string;
  brand?: string | null;
  /** Pre-selected servings[] index (anti-friction default / inferred unit). */
  preselected_serving?: number;
  /** Inferred quantity multiplier from phrasing (MFP "Number of Servings"). */
  inferred_quantity?: number;
  /** Dietary safety assessment (allergens hard-flagged). */
  dietary?: DietarySafetyAssessment;
  /** Present when kind === 'new' — wire to WS2 capture routes. */
  capture?: ResolveCaptureHint;
}

/** Clear-best margin: top must beat runner-up by this much to auto-confirm. */
export const PRESELECT_SCORE_MARGIN = 0.1;

/** Narrow the top pre-select when it's clearly ahead of the runner-up. */
export function pickPreselected(candidates: ResolveCandidate[]): ResolveCandidate | null {
  const top = candidates.find((c) => c.kind !== 'new' && c.dietary?.safe !== false);
  if (!top) return null;
  const runnerUp = candidates.find((c) => c !== top && c.kind !== 'new' && c.dietary?.safe !== false);
  if (!runnerUp) return top;
  return top.score - runnerUp.score >= PRESELECT_SCORE_MARGIN ? top : null;
}
