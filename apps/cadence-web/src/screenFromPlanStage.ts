/** Map plan.stage → top-level App screen (pure; unit-tested). */
export type PlanDrivenScreen = 'meet' | 'onboarding' | 'plan';

/**
 * `new` lands on "meet Cadence" rather than a welcome page: since the v2 flow there is no welcome
 * *inside* the app — the fork (get started / sign in) is pre-auth, and the first thing a signed-in
 * account with no plan should see is the coach introducing herself.
 */
export function screenFromPlanStage(stage: string): PlanDrivenScreen {
  if (stage === 'committed') return 'plan';
  if (stage === 'in_progress') return 'onboarding';
  return 'meet';
}
