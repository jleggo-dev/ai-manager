import { cadenceConfig } from '../config.ts';
import {
  runSynthesize,
  finalizeCoverage,
  synthesizeAndVet,
  commitActivities,
  type SynthesizeOpts,
  type SynthesizeResult,
  type CommitResult,
} from './plan-synthesis.ts';
import type { Activity, Goal } from '@cadence/shared';

/**
 * Fan-out → reduce plan synthesis (the "complete-then-coordinate" path). A single synthesize_plan
 * call juggling N goals anchors on the richest goal and drops the rest (measured 3/5). Here every
 * goal is drafted in ITS OWN focused call — coverage by construction — then ONE reduce call (the
 * same synthesize_plan job, primed with the drafts) reconciles them into a coherent week. All calls
 * stay logged AI Admin jobs; orchestration is app-side, matching how planning already works.
 */

/** One per-goal DRAFT: synthesize in isolation so the goal gets full focus (it may over-scope — the
 *  reduce reconciles). Stamps each draft with its source goal's title so coverage can attribute it. */
async function draftPerGoal(userId: string, goal: Goal, opts: SynthesizeOpts): Promise<Partial<Activity>[]> {
  const { normalized } = await runSynthesize(userId, { ...opts, goals: [goal] });
  return normalized.map((a) => ({ ...a, goal_title: (a as { goal_title?: string }).goal_title ?? goal.title }));
}

/**
 * Fan-out (concurrent per-goal drafts) → reduce (one coordinating synthesize primed with the drafts:
 * dedup shared system activities, deconflict time slots, enforce the weekly load budget) → vet +
 * coverage guarantee. If the reduce drops a goal, its OWN draft is spliced back in by finalizeCoverage
 * — a deterministic backstop, no extra model call.
 */
export async function synthesizeFanoutAndVet(userId: string, opts: SynthesizeOpts): Promise<SynthesizeResult> {
  // 1. Fan-out — draft every goal concurrently, keyed by goal for the coverage backstop.
  const drafts = await Promise.all(
    opts.goals.map((goal) => draftPerGoal(userId, goal, opts).then((activities) => ({ goal, activities }))),
  );
  const allDrafts = drafts.flatMap((d) => d.activities);
  if (allDrafts.length === 0) return { status: 'vetoed', violations: ['fan-out produced no draft activities'] };

  // 2. Reduce — one coordinating synthesize primed with the drafts. Its rationale is the one kept:
  // it is the only call that saw the whole week, so only it can explain the whole shape.
  const { normalized, note, rationale } = await runSynthesize(userId, opts, allDrafts);
  if (normalized.length === 0) return { status: 'vetoed', violations: ['reduce step returned no activities'] };

  // 3. Vet + coverage: recover any goal the reduce dropped from its OWN draft (no extra model call).
  const byGoal = new Map(drafts.map((d) => [d.goal.goal_id, d.activities]));
  return finalizeCoverage(userId, normalized, note, rationale, opts, async (missing) =>
    missing.flatMap((g) => byGoal.get(g.goal_id) ?? []),
  );
}

/**
 * The planning entry point every flow calls. Fan-out → reduce when enabled AND there are ≥2 goals to
 * coordinate (a lone goal has nothing to reconcile — the single call is cheaper and identical);
 * otherwise the single call. Same signature/return as synthesizeAndVet, so lock/replan are drop-in.
 */
export async function planSynthesize(userId: string, opts: SynthesizeOpts): Promise<SynthesizeResult> {
  if (cadenceConfig.aim.planFanout && opts.goals.length >= 2) return synthesizeFanoutAndVet(userId, opts);
  return synthesizeAndVet(userId, opts);
}

/**
 * planSynthesize → commitActivities, back-to-back with no preview step — the shared spine of re-plan's
 * one-shot commit (§6.3). First-lock instead calls the halves separately (services/lock.ts) so the
 * user can review before committing. Replaces the old synthesizeVetCommit, now routed through the
 * fan-out dispatcher.
 */
export async function planSynthesizeVetCommit(
  userId: string,
  opts: SynthesizeOpts & { goalIds: string[]; occurrenceDays?: number },
): Promise<CommitResult> {
  const s = await planSynthesize(userId, opts);
  if (s.status === 'vetoed') return { status: 'vetoed', violations: s.violations };
  return commitActivities(userId, {
    activities: s.activities!,
    note: s.note ?? '',
    rationale: s.rationale,
    goalIds: opts.goalIds,
    occurrenceDays: opts.occurrenceDays,
  });
}
