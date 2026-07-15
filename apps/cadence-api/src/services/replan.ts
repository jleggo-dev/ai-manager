import { listGoalsByStatus } from '../repos/goals.ts';
import { listEquipment } from '../repos/equipment.ts';
import { getUser, setPendingProposal, setPendingPlan } from '../repos/users.ts';
import { getActivePlan } from '../repos/plans.ts';
import { listActivities } from '../repos/activities.ts';
import { listOccurrences } from '../repos/occurrences.ts';
import { rollingConsistency } from './metrics.ts';
import { describeRecurrence } from './scheduling.ts';
import { synthesizeVetCommit, synthesizeAndVet, commitActivities, type CommitResult, type PlanFlowResult } from './plan-synthesis.ts';
import type { Goal } from '@cadence/shared';

const iso = (d: string | Date): string => new Date(d).toISOString().slice(0, 10);

/** How the user has ACTUALLY been doing — the signal the re-plan adapts to. */
async function recentActivity(userId: string, days = 14) {
  const now = new Date();
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const occ = await listOccurrences(userId, iso(new Date(base - (days - 1) * 86_400_000)), iso(new Date(base)));
  const count = (s: string) => occ.filter((o) => o.status === s).length;
  const { kept, window } = rollingConsistency(occ as never, now, 7);
  return {
    window_days: days,
    consistency_last_7_days: `${kept} of ${window} days`,
    done: count('done'),
    skipped: count('skipped'),
    missed: count('missed'),
    scheduled: occ.length,
  };
}

interface ReplanInputs {
  goals: Goal[];
  baseline: unknown;
  equipment: unknown[];
  currentPlan: unknown;
  recentActivity: unknown;
}

/** Shared input-gathering for both replanPlan and previewReplan — null when there's nothing to re-plan. */
async function gatherReplanInputs(userId: string): Promise<ReplanInputs | null> {
  const goals = await listGoalsByStatus(userId, ['committed', 'confirmed']);
  if (goals.length === 0) return null;

  const [user, equipment, activePlan] = await Promise.all([getUser(userId), listEquipment(userId), getActivePlan(userId)]);
  const baseline = user?.baseline ?? {};
  const activities = activePlan ? await listActivities(activePlan.plan_id) : [];

  const currentPlan = activities.map((a) => ({
    title: a.title,
    kind: a.kind,
    cadence: describeRecurrence(a.schedule?.recurrence ?? ''),
    recurrence: a.schedule?.recurrence ?? '',
    time_of_day: a.schedule?.time_of_day,
    target: a.target,
  }));

  return { goals, baseline, equipment, currentPlan, recentActivity: await recentActivity(userId) };
}

/**
 * Adaptive re-plan (Phase 3), UNCHANGED — synthesize → vet → COMMIT in one shot, no preview
 * step. Used by POST /plan/proposal/accept: the weekly banner (reason + suggested levers) IS
 * the user's consent moment, shown before they ever click Accept — a second preview-then-confirm
 * on top of that would be redundant friction for what's meant to be a lightweight weekly nudge.
 * The MANUAL "Adjust my plan" button uses previewReplan/confirmReplan below instead, because
 * clicking that button has no prior consent moment of its own.
 */
export async function replanPlan(userId: string): Promise<CommitResult> {
  const inputs = await gatherReplanInputs(userId);
  if (!inputs) return { status: 'vetoed', violations: ['No active goals to re-plan.'] };

  const result = await synthesizeVetCommit(userId, { ...inputs, goalIds: inputs.goals.map((g) => g.goal_id) });
  // Whatever prompted this re-plan (the manual button, or accepting a coach's proposal) is
  // resolved now — clear any pending proposal so a stale banner can't linger.
  if (result.status === 'committed') await setPendingProposal(userId, null);
  return result;
}

/**
 * First half of the manual "Adjust my plan" flow: synthesize_plan → plan_vet, no commit. Stores
 * the vetted result as pending_plan (same field/mechanism as the first-lock preview in
 * services/lock.ts — a user is only ever in one situation or the other: no active plan yet, or
 * one to evolve) and returns it for display. confirmReplan applies it; dismissReplan discards it.
 */
export async function previewReplan(userId: string, steer?: string): Promise<PlanFlowResult> {
  const inputs = await gatherReplanInputs(userId);
  if (!inputs) return { status: 'vetoed', violations: ['No active goals to re-plan.'] };

  // steer = the user's own requested change in their own words ("one run day isn't enough").
  // Only flows through the preview; confirm commits the previewed pending_plan that embodies it.
  const s = await synthesizeAndVet(userId, { ...inputs, userSteer: steer });
  if (s.status === 'vetoed') return { status: 'vetoed', violations: s.violations };

  const goalIds = inputs.goals.map((g) => g.goal_id);
  const note = s.note ?? '';
  await setPendingPlan(userId, { activities: s.activities!, note, goal_ids: goalIds, created_at: new Date().toISOString() });

  return { status: 'proposed', proposal: { activities: s.activities!, note } };
}

/**
 * Second half: commit the stored pending_plan (clear it + any pending proposal). Self-sufficient
 * — runs previewReplan first if there's nothing on file, so this never errors just because
 * preview wasn't called.
 */
export async function confirmReplan(userId: string): Promise<PlanFlowResult> {
  let pending = (await getUser(userId))?.pending_plan;

  if (!pending) {
    const preview = await previewReplan(userId);
    if (preview.status !== 'proposed') return preview;
    pending = (await getUser(userId))?.pending_plan;
    if (!pending) return { status: 'vetoed', violations: ['Failed to prepare a plan to commit.'] };
  }

  const r = await commitActivities(userId, { activities: pending.activities, note: pending.note, goalIds: pending.goal_ids });
  if (r.status === 'committed') {
    await setPendingPlan(userId, null);
    await setPendingProposal(userId, null);
  }
  return r;
}

/** Discard the pending re-plan preview without committing. */
export async function dismissReplan(userId: string): Promise<void> {
  await setPendingPlan(userId, null);
}
