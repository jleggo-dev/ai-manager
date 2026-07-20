/** Map plan.stage → top-level App screen (pure; unit-tested). */
export type PlanDrivenScreen = 'welcome' | 'onboarding' | 'plan';

export function screenFromPlanStage(stage: string): PlanDrivenScreen {
  if (stage === 'committed') return 'plan';
  if (stage === 'in_progress') return 'onboarding';
  return 'welcome';
}
