import { getUser } from '../repos/users.ts';
import { commitActivities, type PlanFlowResult } from './plan-synthesis.ts';
import { resolveToggledActivities } from './plan-partial-apply.ts';

/**
 * The shared spine of every confirm-and-commit flow — first-lock's `confirmLock` (services/lock.ts),
 * the manual re-plan's `confirmReplan` (services/replan.ts), and (via the same `/plan/lock` route)
 * applying a `propose_plan_change` edit. All three were copy-pasted (API-01): load the stored
 * pending_plan; if nothing is on file, run the flow's preview inline first (self-sufficient — a
 * direct call or smoke script that skipped the preview step still commits a properly vetted plan,
 * never an empty one); resolve any per-item toggles; commit atomically; then run the
 * flow-specific post-commit cleanup. Parameterized by the preview fn + an onCommitted hook so the
 * callers differ only in what they do after a successful commit (lock flips goals → committed;
 * re-plan clears the pending proposal).
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

  // A swap-card's declined items must not simply vanish from the array — commitActivities treats
  // it as the COMPLETE next plan version. See plan-partial-apply.ts for the substitution rule.
  const activities = await resolveToggledActivities(userId, pending.activities);

  const r = await commitActivities(userId, {
    activities,
    note: pending.note,
    rationale: pending.rationale,
    steer: pending.steer,
    goalIds: pending.goal_ids,
    occurrenceDays,
  });
  if (r.status === 'committed') await onCommitted(pending);
  return r;
}
