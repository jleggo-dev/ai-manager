import type { Activity, PendingPlanActivity } from '@cadence/shared';
import { runJobBySlug } from '../ai/aim.ts';
import { logAi } from './ai-log.ts';
import { weatherVarsForUser } from './weather/weather.ts';
import { getActivePlan } from '../repos/plans.ts';
import { listActivities } from '../repos/activities.ts';
import { describeRecurrence } from './scheduling.ts';
import { activityHandle, applyPlanEdits, type PlanEdit } from './plan-edit.ts';
import { PLAN_EDIT_ACTIONS } from './plan-edit-schema.ts';
import {
  parseJson,
  synthesizeAndVet,
  vetAndShape,
  type SynthesizeOpts,
  type SynthesizeResult,
} from './plan-synthesis.ts';

/**
 * Evolving an existing plan by DIFF instead of re-emission (docs/cadence/PLAN-CHANGES.md, Phase 1).
 *
 * Output tokens are the latency: a full-week emission from synthesize-plan is 12–27K completion
 * tokens — 4–9 minutes of pure generation — while an edit list against the current plan is 1–2K,
 * or 30–60s from the same model on the same relay. So the evolve-plan job returns edits in the
 * plan-edit grammar, this file applies them deterministically with the SAME engine
 * `propose_plan_change` uses (applyPlanEdits), and the composed week passes the same vet gate a
 * synthesized one does. The model chooses WHAT changes; code does the changing — an edit nobody
 * asked for is impossible rather than unlikely, exactly as in the chat path.
 *
 * Every failure of the small path — the job unreachable, unparseable output, the model escalating
 * with rebuild:true, zero edits surviving the apply — falls back to the pre-Phase-1 full-synthesis
 * evolve (synthesizeAndVet), so quality can never land below today's; a fallback only costs the
 * old latency. Each fallback is logged with its reason under ai_log kind 'evolve_plan', which is
 * how Phase 1's latency claim gets measured rather than assumed.
 */

/** Words the model reaches for that mean an action by another name. Same table as the chat
 *  tool's argument coercion (coach-actions.ts, asEdits — private to that file, which owns the
 *  whole action-tool graph and is too heavy to import from here). */
const ACTION_ALIASES: Record<string, PlanEdit['action']> = { rename: 'rework', retitle: 'rework', reschedule: 'move' };

/**
 * Model JSON → typed PlanEdit[], dropping anything that is not an edit. Mirrors the coercion the
 * chat tool applies to propose_plan_change arguments, so a shape the chat path accepts is
 * accepted here too. Unknown actions come back by name for the log — reported, never silently
 * filtered (the `rename` lesson, 2026-08-17).
 */
function coerceEdits(raw: unknown): { edits: PlanEdit[]; unknown: string[] } {
  if (!Array.isArray(raw)) return { edits: [], unknown: [] };
  const unknown: string[] = [];
  const edits = raw
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
    .map((e) => ({
      action: (ACTION_ALIASES[String(e.action ?? '').toLowerCase()] ??
        String(e.action ?? '').toLowerCase()) as PlanEdit['action'],
      ...(typeof e.activity === 'string' ? { activity: e.activity } : {}),
      ...(Array.isArray(e.activities) ? { activities: e.activities.map(String) } : {}),
      ...(Array.isArray(e.on_days) ? { on_days: e.on_days.map(String) } : {}),
      ...(Array.isArray(e.days) ? { days: e.days.map(String) } : {}),
      ...(typeof e.time_of_day === 'string' ? { time_of_day: e.time_of_day } : {}),
      ...(e.duration_min != null ? { duration_min: Number(e.duration_min) } : {}),
      ...(typeof e.title === 'string' ? { title: e.title } : {}),
      ...(typeof e.how_to === 'string' ? { how_to: e.how_to } : {}),
      ...(typeof e.goal_title === 'string' ? { goal_title: e.goal_title } : {}),
      ...(typeof e.why === 'string' ? { why: e.why } : {}),
      ...(typeof e.reason === 'string' ? { reason: e.reason } : {}),
      ...(typeof e.optional === 'boolean' ? { optional: e.optional } : {}),
    }))
    .filter((e) => {
      if ((PLAN_EDIT_ACTIONS as readonly string[]).includes(e.action)) return true;
      unknown.push(String(e.action || '(none)'));
      return false;
    });
  return { edits, unknown };
}

/**
 * The plan as the evolve job sees it — one entry per commitment, led by the SAME stable handle
 * `get_active_plan` prints and `applyPlanEdits` resolves (activityHandle over commitment_id).
 * The job addresses commitments only by these handles; deriving them any other way would let the
 * job's view drift from what the apply step accepts.
 */
function currentPlanForJob(activities: Activity[], goalTitleById: Record<string, string>): unknown[] {
  return activities.map((a) => ({
    handle: activityHandle(a.commitment_id),
    title: a.title,
    kind: a.kind,
    cadence: describeRecurrence(a.schedule?.recurrence ?? ''),
    recurrence: a.schedule?.recurrence ?? '',
    ...(a.schedule?.time_of_day ? { time_of_day: a.schedule.time_of_day } : {}),
    ...(a.schedule?.duration_min ? { duration_min: a.schedule.duration_min } : {}),
    ...(a.target ? { target: a.target } : {}),
    ...(a.goal_id && goalTitleById[a.goal_id] ? { goal_title: goalTitleById[a.goal_id] } : {}),
  }));
}

/**
 * The composed week, back in the nested-schedule shape `vetAndShape` feeds plan-vet. The vet is
 * reused as a GATE only: its shaped output drops commitment_id / change_reason / enabled — the
 * lineage (0036) and swap-card fields the edits carry — so the composed activities themselves are
 * what a proposal returns, never the vet's re-shaping.
 */
function forVet(composed: PendingPlanActivity[]): Partial<Activity>[] {
  return composed.map(
    (a) =>
      ({
        title: a.title,
        kind: a.kind,
        ...(a.category ? { category: a.category } : {}),
        schedule: {
          recurrence: a.recurrence,
          ...(a.time_of_day ? { time_of_day: a.time_of_day } : {}),
          ...(a.duration_min ? { duration_min: a.duration_min } : {}),
        },
        ...(a.target ? { target: a.target } : {}),
        completion_source: a.completion_source,
        ...(a.goal_id ? { goal_id: a.goal_id } : {}),
        ...(a.goal_title ? { goal_title: a.goal_title } : {}),
        ...(a.why ? { why: a.why } : {}),
        ...(a.how_to ? { how_to: a.how_to } : {}),
        ...(a.suggested ? { suggested: a.suggested } : {}),
      }) as Partial<Activity>,
  );
}

/** One plain sentence for the user about edits that could not be applied. The full per-edit
 *  reasons are engine-facing text (handle lists, retry steers) — they go to ai_log, not the card. */
function refusedNote(count: number): string {
  return count === 1
    ? 'One of the changes could not be applied, so the rest went ahead without it.'
    : `${count} of the changes could not be applied, so the rest went ahead without them.`;
}

interface EvolveHooks {
  exit: (output: Record<string, unknown>, meta: Record<string, unknown>) => void;
  fallBack: (why: string, detail?: Record<string, unknown>) => Promise<SynthesizeResult>;
}

/** The edits path itself: read the plan, run evolve-plan, apply, vet. Every dead end goes through
 *  `fallBack` (the old full-synthesis behavior) — logged, never silent. */
async function evolveByEdits(userId: string, opts: SynthesizeOpts, hooks: EvolveHooks): Promise<SynthesizeResult> {
  const { exit, fallBack } = hooks;

  const plan = await getActivePlan(userId);
  const activities = plan ? await listActivities(plan.plan_id) : [];
  // Nothing to edit against. Callers route the no-plan case to genesis synthesis already, so
  // reaching this is a race (the plan vanished between their check and ours) — the full path
  // still knows what to do with it.
  if (activities.length === 0) return fallBack('no_active_plan');

  const goalTitleById: Record<string, string> = {};
  for (const g of opts.goals) goalTitleById[g.goal_id] = g.title;

  // Deterministic API weather when home_location is set; empty otherwise — same sourcing as
  // runSynthesize (the template ignores '').
  const { weather } = await weatherVarsForUser(userId).catch(() => ({ weather: '' }));

  let jobRes;
  try {
    jobRes = await runJobBySlug(userId, 'evolve-plan', {
      goals: JSON.stringify(opts.goals),
      baseline: JSON.stringify(opts.baseline),
      equipment: JSON.stringify(opts.equipment),
      current_plan: JSON.stringify(currentPlanForJob(activities, goalTitleById)),
      recent_activity: JSON.stringify(opts.recentActivity ?? ''),
      user_steer: (opts.userSteer ?? '').trim().slice(0, 500),
      weather,
    });
  } catch (e) {
    // The small call failing must not lose the run — the old path still does this job.
    return fallBack('job_failed', { error: String(e).slice(0, 300) });
  }

  // Lenient parse, same as runSynthesize: no expectedSchema on the job, so junk degrades to a
  // fallback rather than a crash.
  const parsed = parseJson(jobRes.formatted ?? jobRes.raw ?? '');
  if (!parsed) return fallBack('unparseable');
  const modelNote = typeof parsed.note === 'string' ? parsed.note.trim() : '';
  // The model's own escalation: this ask needs a rebuilt week, not edits to the standing one.
  if (parsed.rebuild === true) return fallBack('rebuild', { model_note: modelNote.slice(0, 200) });

  const { edits, unknown } = coerceEdits(parsed.edits);
  if (edits.length === 0) return fallBack('no_edits', { unknown_actions: unknown });

  const applied = applyPlanEdits(activities, edits, goalTitleById);
  // Zero applied changes — every edit rejected (bad handles) or a no-op (asking for the state the
  // plan is already in). There is no new week to propose from these edits, so run the old path.
  if (applied.changes.length === 0) {
    return fallBack('no_applied_edits', {
      rejected: applied.rejected.slice(0, 10),
      noops: applied.noops.length,
      unknown_actions: unknown,
    });
  }

  // The same vet gate a synthesized week passes, over the composed result — the app re-checks
  // what the edits add up to, exactly as the job's prompt promises. Coverage recovery is
  // deliberately NOT run here: the current plan anchors coverage by construction, and re-adding
  // work a user-steered remove just took out would override the person (the deterministic chat
  // edit path skips it for the same reason).
  const vet = await vetAndShape(userId, forVet(applied.activities), opts);
  if (vet.status === 'vetoed') {
    exit(
      { vetoed: true, violations: vet.violations, edits_applied: applied.changes.length },
      { ok: false, path: 'edits', fell_back: false, edits_applied: applied.changes.length },
    );
    return { status: 'vetoed', violations: vet.violations };
  }

  // Partial application proceeds with what landed; the user hears about the rest in one plain
  // sentence, and the log carries the engine's full reasons.
  let note = modelNote;
  if (applied.rejected.length) note = [note, refusedNote(applied.rejected.length)].filter(Boolean).join(' ');
  if (!note) note = applied.changes.join('; ');
  const rationale = typeof parsed.rationale === 'string' ? parsed.rationale.trim() : '';

  exit(
    {
      edits: edits.length,
      applied: applied.changes.length,
      rejected: applied.rejected.length,
      noops: applied.noops.length,
      ignored: applied.ignored.length,
      note: note.slice(0, 200),
    },
    { ok: true, path: 'edits', fell_back: false, edits_applied: applied.changes.length },
  );
  // The composed activities go back as-is: they carry commitment_id (lineage, 0036) and the
  // swap-card fields (change_reason, enabled) straight from the edits.
  return { status: 'proposed', activities: applied.activities, note, rationale };
}

/**
 * Evolve the ACTIVE plan through the diff-output job. Same contract as planSynthesize
 * (SynthesizeOpts in, SynthesizeResult out), so replan.ts swaps it in wherever a current plan
 * exists. A vet veto surfaces as 'vetoed' with violations, same shape as today; everything that
 * stops the edits path short of a vet verdict falls back to the full synthesis evolve.
 */
export async function planEvolve(userId: string, opts: SynthesizeOpts): Promise<SynthesizeResult> {
  const startedAt = Date.now();
  // Mirrors runSynthesize's observability: a row on the way in, one on the way out, one on a
  // throw — with elapsed ms, because "is it slow or is it gone" is the actual question here too.
  void logAi(userId, {
    kind: 'evolve_plan',
    input: { goals: opts.goals.length, steer: (opts.userSteer ?? '').trim().slice(0, 200) },
    output: { started: true },
    meta: { goals: opts.goals.length },
  }).catch(() => {});

  const exit = (output: Record<string, unknown>, meta: Record<string, unknown>): void => {
    void logAi(userId, {
      kind: 'evolve_plan',
      input: { goals: opts.goals.length },
      output,
      meta: { ms: Date.now() - startedAt, ...meta },
    }).catch(() => {});
  };

  // The fallback IS the pre-Phase-1 behavior, verbatim — never silent: `why` records which door
  // the slow path came back in through, which is how the diff path's hit rate gets measured.
  const fallBack = async (why: string, detail: Record<string, unknown> = {}): Promise<SynthesizeResult> => {
    const res = await synthesizeAndVet(userId, opts);
    exit(
      { fell_back: true, why, ...detail, status: res.status },
      { ok: res.status === 'proposed', path: 'fallback', fell_back: true, why, edits_applied: 0 },
    );
    return res;
  };

  try {
    return await evolveByEdits(userId, opts, { exit, fallBack });
  } catch (e) {
    // Logged BEFORE rethrowing, so the record does not depend on which caller catches it —
    // the same rule runSynthesize holds.
    exit({ failed: true, error: String(e).slice(0, 300) }, { ok: false });
    throw e;
  }
}
