import { runJobBySlug } from '../ai/aim.ts';
import { sql } from '../db/sql.ts';
import { weatherVarsForUser } from './weather/weather.ts';
import { getActivePlan, supersedeActivePlans, insertPlan } from '../repos/plans.ts';
import { insertActivities } from '../repos/activities.ts';
import { deleteFuturePendingOccurrences } from '../repos/occurrences.ts';
import { getActiveEpisode } from '../repos/episodes.ts';
import { ensureHorizon } from './plan-horizon.ts';
import { toRRule, describeRecurrence } from './scheduling.ts';
import { matchGoal } from './plan-match.ts';
import { splitCoverage } from './plan-coverage.ts';
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
  /** The coach's whole-shape reasoning (0031) — travels beside `note`, persisted at commit. */
  rationale?: string;
  violations?: string[];
}

/** Inputs shared by every synthesis path (single-call, per-goal draft, and reduce). */
export interface SynthesizeOpts {
  goals: Goal[];
  baseline: unknown;
  equipment: unknown[];
  currentPlan?: unknown;
  recentActivity?: unknown;
  userSteer?: string;
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
  proposal?: { activities: PendingPlanActivity[]; note: string; rationale?: string };
  planId?: string;
  version?: number;
  activities?: number;
  occurrences?: number;
  note?: string; // on 'committed' — the coach's one-sentence "what changed and why" (re-plan)
  violations?: string[];
  guardrail?: { weightedLoad: number; activeCount: number };
}

/**
 * Run synthesize_plan (Coach) and normalize its output. `draftActivities`, when present, primes the
 * REDUCE pass with per-goal candidate commitments (fan-out → reduce, see plan-fanout.ts). Evolves the
 * plan when currentPlan/recentActivity are provided. user_steer is empty-safe: the lock flow never
 * sets it and the template treats '' as absent.
 */
export async function runSynthesize(
  userId: string,
  opts: SynthesizeOpts,
  draftActivities?: unknown,
): Promise<{ normalized: Partial<Activity>[]; note: string; rationale: string }> {
  const { weather } = await weatherVarsForUser(userId).catch(() => ({ weather: '' }));
  const synthRes = await runJobBySlug(userId, 'synthesize-plan', {
    goals: JSON.stringify(opts.goals),
    baseline: JSON.stringify(opts.baseline),
    equipment: JSON.stringify(opts.equipment),
    preferences: JSON.stringify((opts.baseline as { preferences?: unknown } | null)?.preferences ?? {}),
    current_plan: JSON.stringify(opts.currentPlan ?? ''),
    recent_activity: JSON.stringify(opts.recentActivity ?? ''),
    user_steer: (opts.userSteer ?? '').trim().slice(0, 500),
    draft_activities: JSON.stringify(draftActivities ?? ''),
    // Deterministic API weather when home_location is set; empty otherwise (template ignores '').
    weather,
  });
  const synth = parseJson(synthRes.formatted ?? synthRes.raw ?? '');
  const normalized = (Array.isArray(synth?.activities) ? (synth!.activities as Partial<Activity>[]) : []).map(
    normalizeActivity,
  );
  const note = typeof synth?.note === 'string' ? synth.note.trim() : '';
  // Lenient by design (no expectedSchema on this job): an older deployed prompt that emits no
  // rationale degrades to '', which every consumer treats as "none" — never a parse failure.
  const rationale = typeof synth?.rationale === 'string' ? synth.rationale.trim() : '';
  return { normalized, note, rationale };
}

/** Map one normalized activity to the display/commit shape, resolving its goal link (matchGoal). */
function shapeActivity(a: Partial<Activity>, goals: Goal[]): PendingPlanActivity {
  // The Coach tags each activity with the confirmed goal it serves (goal_title); resolve it to a real
  // goal_id so the commitment links to its objective (drives the grouped preview AND lets logged
  // accomplishments auto-attach to the right goal's progress). Rides on the spread `a` as an untyped
  // extra field from the model's JSON. `why` is the coach's one-line rationale — display-only, capped.
  const stated = (a as Record<string, unknown>).goal_title;
  const matched = matchGoal(typeof stated === 'string' ? stated : undefined, goals);
  const why = (a as Record<string, unknown>).why;
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
    // 600 is a backstop against runaway output, NOT a style cap: the prompt asks for 1-3
    // explanatory sentences, and the old slice(0, 160) was silently undoing exactly that —
    // truncating the why at the moment it stopped being a label and started being coaching.
    why: typeof why === 'string' && why.trim() ? why.trim().slice(0, 600) : undefined,
    // Coach-proposed adjacent support (0031). Strictly `=== true` so junk shapes stay false-y.
    suggested: (a as Record<string, unknown>).suggested === true || undefined,
  };
}

interface VetShapeResult {
  status: 'proposed' | 'vetoed';
  activities?: PendingPlanActivity[];
  missing?: Goal[];
  violations?: string[];
}

/** plan_vet (Broker, flags verified:false rather than fabricating) → shape → coverage split. */
async function vetAndShape(
  userId: string,
  normalized: Partial<Activity>[],
  opts: SynthesizeOpts,
): Promise<VetShapeResult> {
  // A replan DURING a disrupted episode is vetted against it (the Broker eases expectations rather
  // than flagging the lighter load as under-programming). Null when not in an episode — the common case.
  const activeEpisode = await getActiveEpisode(userId);
  const vetRes = await runJobBySlug(userId, 'plan-vet', {
    proposed_plan: JSON.stringify({ activities: normalized }),
    baseline: JSON.stringify(opts.baseline),
    equipment: JSON.stringify(opts.equipment),
    active_episode: JSON.stringify(activeEpisode),
  });
  const vet = parseJson(vetRes.formatted ?? vetRes.raw ?? '') as PlanVetResult | null;
  if (!vet || vet.verified === false || vet.valid === false) {
    return { status: 'vetoed', violations: vet?.violations ?? ['plan_vet could not verify the plan'] };
  }
  const activities = normalized.map((a) => shapeActivity(a, opts.goals));
  return { status: 'proposed', activities, missing: splitCoverage(activities, opts.goals).missing };
}

/**
 * Vet + shape, then GUARANTEE coverage. If any committed goal is uncovered, recover it ONCE via
 * `recoverMissing` (the single-call path re-synthesizes the missing goals; the fan-out path re-uses
 * their isolated drafts) and re-vet. Never returns a proposal that silently omits a goal — if a gap
 * survives the one repair it VETOES naming the goals, so a partial plan is surfaced, never committed.
 * Shared by synthesizeAndVet and synthesizeFanoutAndVet (plan-fanout.ts).
 */
export async function finalizeCoverage(
  userId: string,
  normalized: Partial<Activity>[],
  note: string,
  rationale: string,
  opts: SynthesizeOpts,
  recoverMissing: (missing: Goal[]) => Promise<Partial<Activity>[]>,
): Promise<SynthesizeResult> {
  let res = await vetAndShape(userId, normalized, opts);
  if (res.status === 'vetoed') return { status: 'vetoed', violations: res.violations };

  if (res.missing?.length) {
    const extra = (await recoverMissing(res.missing)).map(normalizeActivity);
    if (extra.length) {
      res = await vetAndShape(userId, [...normalized, ...extra], opts);
      if (res.status === 'vetoed') return { status: 'vetoed', violations: res.violations };
    }
  }

  if (res.missing?.length) {
    return {
      status: 'vetoed',
      violations: [`plan left goals uncovered: ${res.missing.map((g) => g.title).join('; ')}`],
    };
  }
  return { status: 'proposed', activities: res.activities, note, rationale };
}

/**
 * synthesize_plan (Coach) → plan_vet (Broker) → coverage guarantee — NO commit, no DB writes. Returns
 * a vetted proposal the caller can show the user before anything is applied (suggest-never-auto-apply),
 * or feed straight into commitActivities for a flow that doesn't need a preview step (re-plan). On a
 * re-plan, pass currentPlan + recentActivity so synthesis evolves the plan to fit how the user has
 * actually been doing. This is the SINGLE-CALL path; plan-fanout.ts adds the fan-out → reduce path.
 */
export async function synthesizeAndVet(userId: string, opts: SynthesizeOpts): Promise<SynthesizeResult> {
  const { normalized, note, rationale } = await runSynthesize(userId, opts);
  if (normalized.length === 0) return { status: 'vetoed', violations: ['synthesize_plan returned no activities'] };
  // Coverage repair for the single call: re-synthesize just the goals it dropped and merge them in.
  return finalizeCoverage(userId, normalized, note, rationale, opts, async (missing) => {
    const r = await runSynthesize(userId, { ...opts, goals: missing });
    return r.normalized;
  });
}

/**
 * Commit an already-synthesized-and-vetted proposal as a NEW plan VERSION: supersede the active
 * plan, insert version+1, clear the old plan's stale future-pending occurrences, materialize the
 * rolling horizon. Does no synthesis of its own — call planSynthesize first (directly, or via
 * planSynthesizeVetCommit in plan-fanout.ts for a flow with no preview step).
 */
export async function commitActivities(
  userId: string,
  opts: {
    activities: PendingPlanActivity[];
    note: string;
    rationale?: string;
    goalIds: string[];
    occurrenceDays?: number;
  },
): Promise<CommitResult> {
  const occurrenceDays = opts.occurrenceDays ?? 14;
  const proposed: Partial<Activity>[] = opts.activities.map((a) => ({
    title: a.title,
    kind: a.kind,
    category: a.category,
    goal_id: a.goal_id, // links the committed activity to its objective (insertActivities writes it)
    why: a.why, // rationale persists at commit (0012) — the coach walks the ladder from it later
    suggested: a.suggested, // coach-proposed adjacent support (0031) — dossier data post-commit
    schedule: { recurrence: a.recurrence, time_of_day: a.time_of_day, duration_min: a.duration_min },
    target: a.target,
    completion_source: a.completion_source,
  }));

  const today = new Date().toISOString().slice(0, 10);
  // Atomic (API-01): supersede → insert the new version → insert its activities → clear the old
  // plan's stale future occurrences must be all-or-nothing. Before this, a crash between
  // supersedeActivePlans and insertPlan left the user with NO active plan at all; sql.begin()
  // rolls the whole set back on any failure, so a commit either fully lands or not at all.
  const { plan, version, activityCount } = await sql.begin(async (tx) => {
    const old = await getActivePlan(userId, tx);
    const v = (old?.version ?? 0) + 1;
    await supersedeActivePlans(userId, tx);
    const p = await insertPlan(
      userId,
      { goal_ids: opts.goalIds, version: v, status: 'active', rationale: opts.rationale || null },
      tx,
    );
    const acts = await insertActivities(userId, p.plan_id, proposed, tx);
    if (old) await deleteFuturePendingOccurrences(old.plan_id, today, tx);
    return { plan: p, version: v, activityCount: acts.length };
  });

  // ensureHorizon is a separate, idempotent top-up (safe to re-run) — deliberately OUTSIDE the
  // transaction so materializing the rolling horizon can't hold the commit's write locks open.
  const occurrences = await ensureHorizon(userId, occurrenceDays);

  return {
    status: 'committed',
    planId: plan.plan_id,
    version,
    activities: activityCount,
    occurrences,
    note: opts.note,
  };
}
