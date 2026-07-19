// Naming note (API-01): "lock" is the deliberately-retained INTERNAL verb for committing a plan —
// previewLock/confirmLock/dismissLock, POST /plan/lock. It is NOT a nomenclature violation (no
// user-facing copy says "lock"; the brand's "Set your rhythm" language lives in the UI). The goal
// STATUS this flips into is `committed` (the post-rename value); the verb and the status name
// differ on purpose and both are correct. Don't "fix" one to match the other.
import { listGoalsByStatus, setGoalStatus } from '../repos/goals.ts';
import { listEquipment } from '../repos/equipment.ts';
import { getUser, setPendingPlan } from '../repos/users.ts';
import { evaluateGuardrail } from './goal-guardrail.ts';
import { synthesizeAndVet, type PlanFlowResult } from './plan-synthesis.ts';
import { confirmPendingPlan } from './plan-commit-flow.ts';

/**
 * First half of capture → confirm → preview → lock (spec §6.1, §6.3, §C8.6): deterministic
 * guardrail gate → synthesize_plan → plan_vet. Stores the vetted result as the user's
 * pending_plan and returns it for display. NOTHING is committed here — suggest-never-auto-apply
 * (BRAND.md's autonomy stance), the same pattern already used for the weekly re-plan proposal.
 * confirmLock applies it; dismissLock discards it so the user can go adjust goals instead.
 */
export async function previewLock(userId: string): Promise<PlanFlowResult> {
  const goals = await listGoalsByStatus(userId, ['confirmed']);
  if (goals.length === 0) return { status: 'vetoed', violations: ['No confirmed goals to lock.'] };

  const [user, equipment] = await Promise.all([getUser(userId), listEquipment(userId)]);
  const baseline = user?.baseline ?? {};

  // Deterministic guardrail gate (§6.2), first lock only (re-plan doesn't re-gate). ONLY the hard
  // cap blocks the commit. The focus BUDGET is soft by design (see goal-guardrail.ts): a race plus
  // a couple of everyday habits is exactly the "several life areas at once" the brand supports, so
  // it must never wall off the lock — especially with no keep/park UI to resolve it. The weighted
  // load still rides along in GET /review's guardrail object for a future non-blocking nudge.
  const g = evaluateGuardrail(goals);
  if (g.exceedsHardCap) {
    return { status: 'needs_focus', guardrail: { weightedLoad: g.weightedLoad, activeCount: g.activeCount } };
  }

  const s = await synthesizeAndVet(userId, { goals, baseline, equipment });
  if (s.status === 'vetoed') return { status: 'vetoed', violations: s.violations };

  const goalIds = goals.map((gg) => gg.goal_id);
  const note = s.note ?? '';
  await setPendingPlan(userId, {
    activities: s.activities!,
    note,
    goal_ids: goalIds,
    created_at: new Date().toISOString(),
  });

  return { status: 'proposed', proposal: { activities: s.activities!, note } };
}

/**
 * Second half: commit the user's stored pending_plan (flip confirmed goals → committed, clear
 * the preview). Self-sufficient — if no preview is on file (a direct call, a smoke script, or
 * any caller that skips the preview step), runs previewLock first so this never errors just
 * because preview wasn't called; it only ever commits a plan that's actually been vetted.
 */
export async function confirmLock(userId: string, occurrenceDays = 14): Promise<PlanFlowResult> {
  return confirmPendingPlan(
    userId,
    () => previewLock(userId),
    async (pending) => {
      // First lock's post-commit: flip the confirmed goals → committed, clear the preview.
      for (const goalId of pending.goal_ids) await setGoalStatus(userId, goalId, 'committed');
      await setPendingPlan(userId, null);
    },
    occurrenceDays,
  );
}

/** Discard the pending preview without committing — the user goes back to Review to adjust. */
export async function dismissLock(userId: string): Promise<void> {
  await setPendingPlan(userId, null);
}
