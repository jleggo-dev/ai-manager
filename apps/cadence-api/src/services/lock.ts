// Naming note (API-01): "lock" is the deliberately-retained INTERNAL verb for committing a plan —
// previewLock/confirmLock/dismissLock, POST /plan/lock. It is NOT a nomenclature violation (no
// user-facing copy says "lock"; the brand's "Set your rhythm" language lives in the UI). The goal
// STATUS this flips into is `committed` (the post-rename value); the verb and the status name
// differ on purpose and both are correct. Don't "fix" one to match the other.
import { listGoalsByStatus, setGoalStatus } from '../repos/goals.ts';
import { listEquipment } from '../repos/equipment.ts';
import { getUser, setPendingPlan } from '../repos/users.ts';
import { evaluateGuardrail } from './goal-guardrail.ts';
import { observedHealthForPlanning } from './observed-health.ts';
import { type PlanFlowResult } from './plan-synthesis.ts';
import { planSynthesize } from './plan-fanout.ts';
import { confirmPendingPlan } from './plan-commit-flow.ts';
import { sendPlanReadyPush } from './plan-ready-push.ts';

/**
 * First half of capture → confirm → preview → lock (spec §6.1, §6.3, §C8.6): deterministic
 * guardrail gate → synthesize_plan → plan_vet. Stores the vetted result as the user's
 * pending_plan and returns it for display. NOTHING is committed here — suggest-never-auto-apply
 * (BRAND.md's autonomy stance), the same pattern already used for the weekly re-plan proposal.
 * confirmLock applies it; dismissLock discards it so the user can go adjust goals instead.
 */
export async function previewLock(userId: string): Promise<PlanFlowResult> {
  // Reconcile the live captured set into scope FIRST. A goal still `captured` at lock — a direct
  // /plan/lock, or goals captured after the wizard's confirm step — would otherwise be silently
  // excluded from the plan (the root cause of a multi-goal onboarding producing a one-goal plan).
  // Confirming here is the same effect as the wizard's doPreview (confirmGoals), so nothing the user
  // has told us gets stranded; captured→confirmed also makes them immune to later capture churn.
  const captured = await listGoalsByStatus(userId, ['captured']);
  for (const cg of captured) await setGoalStatus(userId, cg.goal_id, 'confirmed');

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

  // A FIRST plan is exactly when observed history matters most, and it used to be the one path
  // that sent none: `recentActivity` was simply omitted here, which plan-synthesis renders as the
  // empty string. So an ultra runner with ten logged runs in the last ninety days — the most
  // recent of them yesterday — was planned for as though nobody had ever seen him move, and got a
  // weekly walk. We have no occurrences of our own yet at this point; his own devices are the ONLY
  // evidence in existence, and passing nothing threw it away.
  //
  // `current_plan` stays empty, so the template's first-plan branch is untouched: this adds
  // evidence about the person, it does not turn a first plan into a re-plan.
  const observed = await observedHealthForPlanning(userId);
  const s = await planSynthesize(userId, {
    goals,
    baseline,
    equipment,
    ...(observed ? { recentActivity: { observed_health: observed } } : {}),
  });
  if (s.status === 'vetoed') return { status: 'vetoed', violations: s.violations };

  const goalIds = goals.map((gg) => gg.goal_id);
  const note = s.note ?? '';
  await setPendingPlan(userId, {
    activities: s.activities!,
    note,
    rationale: s.rationale,
    goal_ids: goalIds,
    created_at: new Date().toISOString(),
  });

  return { status: 'proposed', proposal: { activities: s.activities!, note, rationale: s.rationale } };
}

/**
 * Second half: commit the user's stored pending_plan (flip confirmed goals → committed, clear
 * the preview). Self-sufficient — if no preview is on file (a direct call, a smoke script, or
 * any caller that skips the preview step), runs previewLock first so this never errors just
 * because preview wasn't called; it only ever commits a plan that's actually been vetted.
 */
export async function confirmLock(userId: string, occurrenceDays = 14): Promise<PlanFlowResult> {
  const result = await confirmPendingPlan(
    userId,
    () => previewLock(userId),
    async (pending) => {
      // First lock's post-commit: flip the confirmed goals → committed, clear the preview.
      for (const goalId of pending.goal_ids) await setGoalStatus(userId, goalId, 'committed');
      await setPendingPlan(userId, null);
    },
    occurrenceDays,
  );

  // "Your week is ready" — the doom-scroll contract's second half. The build runs minutes and the
  // builder said so out loud ("leave the app if you like"), so the finish has to be able to reach
  // a pocket. FIRST plan only (version 1): a rebuild is agreed in a live conversation with the
  // person right there, and pinging the phone in their hand is noise.
  if (result.status === 'committed' && result.version === 1) {
    await sendPlanReadyPush(
      userId,
      'plan_ready',
      result.planId ?? `v${result.version}`,
      'Your first week is ready',
      'Come take a look — and push back on anything.',
    );
  }
  return result;
}

/** Discard the pending preview without committing — the user goes back to Review to adjust. */
export async function dismissLock(userId: string): Promise<void> {
  await setPendingPlan(userId, null);
}
