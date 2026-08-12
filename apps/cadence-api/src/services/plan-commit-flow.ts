import { getUser } from '../repos/users.ts';
import { commitActivities, type PlanFlowResult } from './plan-synthesis.ts';

/**
 * The shared spine of both confirm-and-commit flows — first-lock's `confirmLock` (services/lock.ts)
 * and the manual re-plan's `confirmReplan` (services/replan.ts). Both were copy-pasted (API-01):
 * load the stored pending_plan; if nothing is on file, run the flow's preview inline first
 * (self-sufficient — a direct call or smoke script that skipped the preview step still commits a
 * properly vetted plan, never an empty one); commit atomically; then run the flow-specific
 * post-commit cleanup. Parameterized by the preview fn + an onCommitted hook so the two callers
 * differ only in what they do after a successful commit (lock flips goals → committed; re-plan
 * clears the pending proposal).
 */
export async function confirmPendingPlan(
  userId: string,
  preview: () => Promise<PlanFlowResult>,
  onCommitted: (pending: { goal_ids: string[] }) => Promise<void>,
  occurrenceDays?: number,
): Promise<PlanFlowResult> {
  let pending = (await getUser(userId))?.pending_plan;

  if (!pending) {
    const p = await preview();
    if (p.status !== 'proposed') return p; // vetoed / needs_focus — surface as-is
    pending = (await getUser(userId))?.pending_plan;
    if (!pending) return { status: 'vetoed', violations: ['Failed to prepare a plan to commit.'] };
  }

  const r = await commitActivities(userId, {
    activities: pending.activities,
    note: pending.note,
    rationale: pending.rationale,
    goalIds: pending.goal_ids,
    occurrenceDays,
  });
  if (r.status === 'committed') await onCommitted(pending);
  return r;
}
