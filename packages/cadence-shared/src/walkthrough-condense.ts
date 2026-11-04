/**
 * The "I have less time" version of a walkthrough (walkthrough.ts kept the projection; this is the
 * one trimming rule, moved out so that file stays under the size gate).
 */
import type { Walkthrough, WalkthroughStep } from './walkthrough.ts';

/**
 * The "I have less time" version. Rule (from the redesign spec): keep the **setup** step plus the
 * **core** (longest) step at HALF its duration (min 2 min); if the task has ≤2 steps, keep them
 * all. The core is never dropped — a condensed run must still contain the run. Deterministic; a
 * 4-step run [3,2,20,5] condenses to [warm-up 3, run 10] = 13 min.
 */
export function condense(w: Walkthrough): Walkthrough {
  const steps = w.steps;
  const setup = steps[0];
  if (steps.length <= 2 || !setup) return { steps: steps.map((s) => ({ ...s })), total_min: w.total_min };

  const core = steps.find((s) => s.core) ?? steps.reduce((a, b) => (b.minutes > a.minutes ? b : a), setup);
  const halvedCore: WalkthroughStep = { ...core, minutes: Math.max(2, Math.round(core.minutes / 2)) };

  const kept: WalkthroughStep[] = setup.id === core.id ? [halvedCore] : [{ ...setup }, halvedCore];
  return { steps: kept, total_min: kept.reduce((sum, s) => sum + s.minutes, 0) };
}
