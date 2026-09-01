import { listGoalsByStatus } from '../repos/goals.ts';
import { listEquipment } from '../repos/equipment.ts';
import { getUser, setPendingProposal, setPendingPlan } from '../repos/users.ts';
import { getActivePlan } from '../repos/plans.ts';
import { listActivities } from '../repos/activities.ts';
import { listOccurrences } from '../repos/occurrences.ts';
import { listNutritionLogs } from '../repos/nutrition.ts';
import { summarizeNutrition } from './nutrition-summarize.ts';
import { rollingConsistency } from './metrics.ts';
import { describeRecurrence } from './scheduling.ts';
import { observedHealthForPlanning, PLAN_COUNTS_NOTE } from './observed-health.ts';
import { commitActivities, type CommitResult, type PlanFlowResult } from './plan-synthesis.ts';
import { planSynthesize, planSynthesizeVetCommit } from './plan-fanout.ts';
import { planEvolve } from './plan-evolve.ts';
import { resolveToggledActivities } from './plan-partial-apply.ts';
import type { PlanRun } from '../repos/users.ts';
import { confirmPendingPlan } from './plan-commit-flow.ts';
import { sendPlanReadyPush } from './plan-ready-push.ts';
import type { Goal } from '@cadence/shared';

const iso = (d: string | Date): string => new Date(d).toISOString().slice(0, 10);

/**
 * How the user has ACTUALLY been doing — the signal the re-plan adapts to.
 *
 * TWO sources, deliberately kept apart. The occurrence/nutrition counts describe how they engaged
 * with OUR plan; `observed_health` describes what their own devices measured, plan or no plan.
 * Someone can be training hard and still miss every session we scheduled, so folding one into the
 * other would produce a confident wrong answer in whichever direction happened to dominate.
 *
 * The occurrence keys stay at the TOP level on purpose: the synthesize_plan template already names
 * `food_log` and reasons about the size of this object, and re-nesting them to look tidier would
 * quietly break prompt language this change does not own. PLAN_COUNTS_NOTE labels them in place.
 */
async function recentActivity(userId: string, days = 14) {
  const now = new Date();
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const from = iso(new Date(base - (days - 1) * 86_400_000));
  const to = iso(new Date(base));
  const occ = await listOccurrences(userId, from, to);
  const count = (s: string) => occ.filter((o) => o.status === s).length;
  const { kept, window } = rollingConsistency(occ, now, 7);
  // Observe-phase food signal: days_logged is the nutrition module's phase gate — synthesis
  // holds off on eating changes below ~7 logged days, then introduces ONE at a time.
  const nutrition = summarizeNutrition(await listNutritionLogs(userId, from, to), days);
  const observed = await observedHealthForPlanning(userId);
  return {
    window_days: days,
    what_these_counts_mean: PLAN_COUNTS_NOTE,
    consistency_last_7_days: `${kept} of ${window} days`,
    done: count('done'),
    skipped: count('skipped'),
    missed: count('missed'),
    scheduled: occ.length,
    ...(nutrition.meals_logged
      ? {
          food_log: {
            days_logged: nutrition.days_logged,
            meals_per_logged_day: nutrition.meals_per_logged_day,
            top_items: nutrition.top_items,
            alcohol_days: nutrition.alcohol_days,
          },
        }
      : {}),
    ...(observed ? { observed_health: observed } : {}),
  };
}

interface ReplanInputs {
  goals: Goal[];
  baseline: unknown;
  equipment: unknown[];
  /** One entry per active-plan activity; empty when there is no active plan. Its length is what
   *  routes a re-plan to the diff path (planEvolve) vs genesis synthesis (planSynthesize). */
  currentPlan: unknown[];
  recentActivity: unknown;
}

/** Shared input-gathering for both replanPlan and previewReplan — null when there's nothing to
 *  re-plan. Exported for scripts/probe-evolve-plan.ts, which probes the evolve job with a real
 *  plan without writing pending_plan or pinging anyone. */
export async function gatherReplanInputs(userId: string): Promise<ReplanInputs | null> {
  const goals = await listGoalsByStatus(userId, ['committed', 'confirmed']);
  if (goals.length === 0) return null;

  const [user, equipment, activePlan] = await Promise.all([
    getUser(userId),
    listEquipment(userId),
    getActivePlan(userId),
  ]);
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
export async function replanPlan(
  userId: string,
  steer?: string,
  // Narrates the run for the plan_run record (services/plan-run.ts) — a callback, not an import,
  // so this stays callable without any run machinery (smoke scripts, a direct call).
  onStage?: (stage: NonNullable<PlanRun['stage']>) => void,
): Promise<CommitResult> {
  onStage?.('reading');
  const inputs = await gatherReplanInputs(userId);
  if (!inputs) return { status: 'vetoed', violations: ['No active goals to re-plan.'] };

  // `steer` lets a caller frame the synthesis (e.g. the Req 4 re-baseline: reassess from scratch
  // after a long break). Undefined for a plain adaptive re-plan.
  onStage?.('drafting');
  // A current plan takes the diff path — planEvolve returns edits applied in code instead of a
  // re-emitted week (PLAN-CHANGES.md Phase 1) — then commits through the same commitActivities.
  // With nothing to evolve, genesis synthesis runs exactly as before.
  const result = inputs.currentPlan.length
    ? await evolveAndCommit(userId, inputs, steer, onStage)
    : await planSynthesizeVetCommit(userId, {
        ...inputs,
        userSteer: steer,
        goalIds: inputs.goals.map((g) => g.goal_id),
        // 'saving' fires between synthesis succeeding and the commit landing — the last stage the
        // client sees before the record clears and the new plan version answers for itself.
        onSaving: onStage ? () => onStage('saving') : undefined,
      });
  // Whatever prompted this re-plan (the manual button, or accepting a coach's proposal) is
  // resolved now — clear any pending proposal so a stale banner can't linger.
  if (result.status === 'committed') await setPendingProposal(userId, null);
  return result;
}

/**
 * The evolve half of replanPlan: planEvolve → commit, mirroring planSynthesizeVetCommit's spine
 * (plan-fanout.ts) with the diff-output path in the synthesis seat.
 */
async function evolveAndCommit(
  userId: string,
  inputs: ReplanInputs,
  steer: string | undefined,
  onStage?: (stage: NonNullable<PlanRun['stage']>) => void,
): Promise<CommitResult> {
  const s = await planEvolve(userId, { ...inputs, userSteer: steer });
  if (s.status === 'vetoed') return { status: 'vetoed', violations: s.violations };
  onStage?.('saving');
  // An edit the model marked take-it-or-leave-it (enabled false) has no toggle moment in this
  // one-shot flow — resolve it the way the preview funnel does (plan-partial-apply.ts): keep the
  // committed version, or drop a declined add, rather than committing an offer nobody accepted.
  const activities = await resolveToggledActivities(userId, s.activities!);
  return commitActivities(userId, {
    activities,
    note: s.note ?? '',
    rationale: s.rationale,
    goalIds: inputs.goals.map((g) => g.goal_id),
  });
}

/**
 * The steer for a Req 4 "re-baseline" — accepted after a long absence or a long detour. It tells
 * synthesis to reassess the user's starting point rather than resume the old plan at its old level:
 * a coach-driven fresh look, not a silent replan.
 */
export const REBASELINE_STEER =
  'The user is returning after an extended break. Reassess their starting point from scratch — do not assume they held their previous level. Rebuild a gentle on-ramp that eases them back in over the next couple of weeks before returning to full load.';

/**
 * First half of the manual "Adjust my plan" flow: synthesize_plan → plan_vet, no commit. Stores
 * the vetted result as pending_plan (same field/mechanism as the first-lock preview in
 * services/lock.ts — a user is only ever in one situation or the other: no active plan yet, or
 * one to evolve) and returns it for display. confirmReplan applies it; dismissReplan discards it.
 */
export async function previewReplan(
  userId: string,
  steer?: string,
  // Narrates the run for the plan_run record (services/plan-run.ts) — see replanPlan.
  onStage?: (stage: NonNullable<PlanRun['stage']>) => void,
): Promise<PlanFlowResult> {
  onStage?.('reading');
  const inputs = await gatherReplanInputs(userId);
  if (!inputs) return { status: 'vetoed', violations: ['No active goals to re-plan.'] };

  // steer = the user's own requested change in their own words ("one run day isn't enough").
  // Only flows through the preview; confirm commits the previewed pending_plan that embodies it.
  onStage?.('drafting');
  // A current plan takes the diff path (planEvolve — PLAN-CHANGES.md Phase 1); with nothing to
  // diff against, genesis synthesis runs. Same result contract either way.
  const synthesize = inputs.currentPlan.length ? planEvolve : planSynthesize;
  const s = await synthesize(userId, { ...inputs, userSteer: steer });
  if (s.status === 'vetoed') return { status: 'vetoed', violations: s.violations };

  onStage?.('saving');
  const goalIds = inputs.goals.map((g) => g.goal_id);
  const note = s.note ?? '';
  const createdAt = new Date().toISOString();
  await setPendingPlan(userId, {
    activities: s.activities!,
    note,
    rationale: s.rationale,
    // Carried so the COMMIT can write it onto the plan version (0034). The ask outlives the
    // prompt it was typed into: without this the week changes and nothing records why.
    ...(steer?.trim() ? { steer: steer.trim() } : {}),
    goal_ids: goalIds,
    created_at: createdAt,
  });

  // Measured at 271s for four goals (scripts/probe-replan-preview.ts), and it grows with every
  // goal added — nobody watches a phone for four and a half minutes. The sheet now says so and
  // invites them to leave, which makes the ping the other half of that promise rather than noise.
  // Keyed on createdAt so re-running a preview pings again, but a retry of the same one does not.
  await sendPlanReadyPush(
    userId,
    'replan_ready',
    createdAt,
    'Your adjusted week is ready',
    'Come have a look — nothing changes until you say so.',
  );

  return { status: 'proposed', proposal: { activities: s.activities!, note, rationale: s.rationale } };
}

/**
 * Second half: commit the stored pending_plan (clear it + any pending proposal). When nothing is
 * on file the confirm now REFUSES instead of quietly re-running the preview inline: that fallback
 * meant a race (the preview dismissed or expired between screens) turned "apply my small edit"
 * into a full blocking rebuild the user never asked for — minutes of synthesis behind a button
 * that promised seconds. The closure returns the veto and confirmPendingPlan surfaces it as-is;
 * the flow's shared spine (plan-commit-flow.ts) is unchanged.
 */
export async function confirmReplan(userId: string): Promise<PlanFlowResult> {
  return confirmPendingPlan(
    userId,
    async () => ({ status: 'vetoed', violations: ['That adjustment expired — run the preview again.'] }),
    async () => {
      // Re-plan's post-commit: clear both the preview and any lingering weekly proposal banner.
      await setPendingPlan(userId, null);
      await setPendingProposal(userId, null);
    },
  );
}

/** Discard the pending re-plan preview without committing. */
export async function dismissReplan(userId: string): Promise<void> {
  await setPendingPlan(userId, null);
}
