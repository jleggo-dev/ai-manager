import { runJob } from '../ai/aim.ts';
import { cadenceConfig } from '../config.ts';
import { getActivePlan, supersedeActivePlans, insertPlan } from '../repos/plans.ts';
import { insertActivities } from '../repos/activities.ts';
import { deleteFuturePendingOccurrences } from '../repos/occurrences.ts';
import { ensureHorizon } from './plan-horizon.ts';
import { toRRule, describeRecurrence } from './scheduling.ts';
import { matchGoal } from './plan-match.ts';
import type { Activity, Goal, PendingPlanActivity, PlanVetResult } from '@cadence/shared';

const COMPLETION_SOURCES = new Set(['self_report', 'healthkit', 'reply', 'auto']);

/** App-side contract assertion (§C4): coerce synthesized activities to our schema/enums. */
export function normalizeActivity(a: Partial<Activity>): Partial<Activity> {
  const sched = (a.schedule ?? {}) as Record<string, unknown>;
  return {
    ...a,
    kind: a.kind === 'system' ? 'system' : 'user',
    completion_source:
      a.completion_source && COMPLETION_SOURCES.has(a.completion_source) ? a.completion_source : 'self_report',
    schedule: { ...sched, recurrence: toRRule(sched) } as Activity['schedule'],
  };
}

function parseJson(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export interface CommitResult {
  status: 'committed' | 'vetoed';
  planId?: string;
  version?: number;
  activities?: number;
  occurrences?: number;
  note?: string;
  violations?: string[];
}

export interface SynthesizeResult {
  status: 'proposed' | 'vetoed';
  activities?: PendingPlanActivity[];
  note?: string;
  violations?: string[];
}

/**
 * The full preview-then-commit result shape, shared by both flows that offer a preview step
 * before applying a synthesized plan: services/lock.ts (first lock) and services/replan.ts
 * (the manual "Adjust my plan" button). `guardrail`/`needs_focus` only ever come from lock —
 * re-plan doesn't re-gate (an existing, deliberate decision: the user already passed the gate
 * once at first lock) — but the shape is the same either way so callers handle both uniformly.
 */
export interface PlanFlowResult {
  status: 'proposed' | 'committed' | 'needs_focus' | 'vetoed';
  proposal?: { activities: PendingPlanActivity[]; note: string };
  planId?: string;
  version?: number;
  activities?: number;
  occurrences?: number;
  note?: string; // on 'committed' — the coach's one-sentence "what changed and why" (re-plan)
  violations?: string[];
  guardrail?: { weightedLoad: number; activeCount: number };
}

/**
 * synthesize_plan (Coach) → plan_vet (Broker) — NO commit, no DB writes. Returns a vetted
 * proposal the caller can show the user before anything is applied (suggest-never-auto-apply),
 * or feed straight into commitActivities for a flow that doesn't need a preview step (re-plan).
 * On a re-plan, pass currentPlan + recentActivity so synthesis evolves the plan to fit how the
 * user has actually been doing.
 */
export async function synthesizeAndVet(
  userId: string,
  opts: { goals: Goal[]; baseline: unknown; equipment: unknown[]; currentPlan?: unknown; recentActivity?: unknown; userSteer?: string },
): Promise<SynthesizeResult> {
  // 1. Synthesize (Coach) — evolves the plan when currentPlan/recentActivity are provided.
  // user_steer is empty-safe: the lock flow never sets it and the template treats '' as absent.
  const synthRes = await runJob(userId, cadenceConfig.aim.jobs.synthesizePlan, {
    goals: JSON.stringify(opts.goals),
    baseline: JSON.stringify(opts.baseline),
    equipment: JSON.stringify(opts.equipment),
    preferences: JSON.stringify((opts.baseline as { preferences?: unknown } | null)?.preferences ?? {}),
    current_plan: JSON.stringify(opts.currentPlan ?? ''),
    recent_activity: JSON.stringify(opts.recentActivity ?? ''),
    user_steer: (opts.userSteer ?? '').trim().slice(0, 500),
  });
  const synth = parseJson(synthRes.formatted ?? synthRes.raw ?? '');
  const normalized = (Array.isArray(synth?.activities) ? (synth!.activities as Partial<Activity>[]) : []).map(normalizeActivity);
  const note = typeof synth?.note === 'string' ? synth.note.trim() : '';
  if (normalized.length === 0) return { status: 'vetoed', violations: ['synthesize_plan returned no activities'] };

  // 2. Vet (Broker) — flags verified:false rather than fabricating.
  const vetRes = await runJob(userId, cadenceConfig.aim.jobs.planVet, {
    proposed_plan: JSON.stringify({ activities: normalized }),
    baseline: JSON.stringify(opts.baseline),
    equipment: JSON.stringify(opts.equipment),
    active_episode: JSON.stringify(null),
  });
  const vet = parseJson(vetRes.formatted ?? vetRes.raw ?? '') as PlanVetResult | null;
  if (!vet || vet.verified === false || vet.valid === false) {
    return { status: 'vetoed', violations: vet?.violations ?? ['plan_vet could not verify the plan'] };
  }

  // Display (cadence) and commit (recurrence) both need this, computed once so neither side
  // — the preview response now, commitActivities later — has to re-derive it.
  const activities: PendingPlanActivity[] = normalized.map((a) => {
    // The Coach tags each activity with the confirmed goal it serves (goal_title); resolve it to a
    // real goal_id so the commitment links to its objective (drives the grouped preview AND lets
    // logged accomplishments auto-attach to the right goal's progress). Rides on the spread `a` as
    // an untyped extra field from the model's JSON.
    const stated = (a as Record<string, unknown>).goal_title;
    const matched = matchGoal(typeof stated === 'string' ? stated : undefined, opts.goals);
    return {
      title: a.title ?? '',
      kind: a.kind === 'system' ? 'system' : 'user',
      category: a.category,
      cadence: describeRecurrence(a.schedule?.recurrence ?? ''),
      recurrence: a.schedule?.recurrence ?? '',
      time_of_day: a.schedule?.time_of_day,
      duration_min: a.schedule?.duration_min,
      target: a.target,
      completion_source: a.completion_source ?? 'self_report',
      goal_id: matched?.goal_id,
      goal_title: matched?.title,
    };
  });

  return { status: 'proposed', activities, note };
}

/**
 * Commit an already-synthesized-and-vetted proposal as a NEW plan VERSION: supersede the active
 * plan, insert version+1, clear the old plan's stale future-pending occurrences, materialize the
 * rolling horizon. Does no synthesis of its own — call synthesizeAndVet first (directly, or via
 * synthesizeVetCommit below for a flow with no preview step).
 */
export async function commitActivities(
  userId: string,
  opts: { activities: PendingPlanActivity[]; note: string; goalIds: string[]; occurrenceDays?: number },
): Promise<CommitResult> {
  const occurrenceDays = opts.occurrenceDays ?? 14;
  const proposed: Partial<Activity>[] = opts.activities.map((a) => ({
    title: a.title,
    kind: a.kind,
    category: a.category,
    goal_id: a.goal_id, // links the committed activity to its objective (insertActivities writes it)
    schedule: { recurrence: a.recurrence, time_of_day: a.time_of_day, duration_min: a.duration_min },
    target: a.target,
    completion_source: a.completion_source,
  }));

  const old = await getActivePlan(userId);
  const version = (old?.version ?? 0) + 1;
  await supersedeActivePlans(userId);
  const plan = await insertPlan(userId, { goal_ids: opts.goalIds, version, status: 'active' });
  const activities = await insertActivities(userId, plan.plan_id, proposed);
  if (old) await deleteFuturePendingOccurrences(old.plan_id, new Date().toISOString().slice(0, 10));
  const occurrences = await ensureHorizon(userId, occurrenceDays);

  return { status: 'committed', planId: plan.plan_id, version, activities: activities.length, occurrences, note: opts.note };
}

/**
 * The shared spine of both first-lock and re-plan (§6.3): synthesizeAndVet → commitActivities,
 * back-to-back with no preview step in between. Re-plan uses this unchanged; first-lock instead
 * calls the two halves separately (services/lock.ts) so the user can review before committing.
 */
export async function synthesizeVetCommit(
  userId: string,
  opts: {
    goals: Goal[];
    baseline: unknown;
    equipment: unknown[];
    goalIds: string[];
    currentPlan?: unknown;
    recentActivity?: unknown;
    occurrenceDays?: number;
  },
): Promise<CommitResult> {
  const s = await synthesizeAndVet(userId, opts);
  if (s.status === 'vetoed') return { status: 'vetoed', violations: s.violations };
  return commitActivities(userId, {
    activities: s.activities!,
    note: s.note ?? '',
    goalIds: opts.goalIds,
    occurrenceDays: opts.occurrenceDays,
  });
}
