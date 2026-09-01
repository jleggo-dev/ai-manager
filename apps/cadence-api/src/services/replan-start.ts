import { previewReplan } from './replan.ts';
import { launchPlanRun, planRunStage } from './plan-run.ts';

/**
 * The one way a background week-rebuild PREVIEW starts (Phase 2, docs/cadence/PLAN-CHANGES.md).
 *
 * Two doors reach it — the Adjust sheet's POST /plan/replan/preview and the coach's
 * `start_replan` tool — and they must behave identically: claim the user's single plan_run,
 * synthesize in the background with stage stamps, land the result as the pending proposal card
 * (previewReplan pushes when it is ready, plan-run.ts pushes when it fails). Extracted from the
 * route body verbatim so the second caller could not drift from the first.
 *
 * Its own module rather than plan-run.ts because plan-run.ts is generic run machinery with a
 * deliberately small import graph (the plan renderer reads it on every turn), and previewReplan
 * drags the whole synthesis stack behind it.
 */
export async function startReplanRun(userId: string, steer?: string): Promise<'started' | 'joined'> {
  return launchPlanRun(userId, 'replan_preview', () =>
    previewReplan(userId, steer, (stage) => planRunStage(userId, stage)),
  );
}
