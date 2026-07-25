/**
 * Pure Resolve types + pre-select helper (no DB). Kept separate so unit tests
 * don't load the postgres client / env.
 */

export type ResolveCandidateKind = 'food' | 'recipe' | 'new';

export interface ResolveInput {
  /** Typed text, a coach turn fragment, or a short description. */
  text: string;
}

export interface ResolveCandidate {
  kind: ResolveCandidateKind;
  /** Higher is better; stub scores are deterministic from rank order. */
  score: number;
  label: string;
  food_id?: string;
  recipe_id?: string;
  brand?: string | null;
  /** Pre-selected servings[] index (anti-friction default). */
  preselected_serving?: number;
}

/** Narrow the top pre-select when it's clearly ahead of the runner-up (WS-R tuning later). */
export function pickPreselected(candidates: ResolveCandidate[]): ResolveCandidate | null {
  const top = candidates.find((c) => c.kind !== 'new');
  if (!top) return null;
  const runnerUp = candidates.find((c) => c !== top && c.kind !== 'new');
  if (!runnerUp) return top;
  // Stub threshold: clearly best when ≥0.1 ahead.
  return top.score - runnerUp.score >= 0.1 ? top : null;
}
