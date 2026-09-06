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
 *
 * GENESIS-ONLY (Phase 0, docs/cadence/PLAN-CHANGES.md). Fan-out exists because a first plan has
 * nothing to anchor on — that is where goals got dropped. An EVOLVE call is handed the current
 * plan, which already covers every goal, so coverage holds by construction and fanning out just
 * multiplies a minutes-long call by the goal count (the 2026-08-31 incident: four concurrent
 * drafts, all dead at undici's 300s ceiling). shouldFanout is the one gate.
 */

/** How many per-goal drafts run at once. Each is a real provider call minutes long; an unbounded
 *  Promise.all over goals is how the gemini family got rate-limited all at once on 2026-08-20
 *  (same reasoning as prefetchImminentSessions' cap, services/session-generate.ts). */
const DRAFT_CONCURRENCY = 3;

/**
 * Fan-out only for a FIRST plan with goals to coordinate: the kill switch is on, there are ≥2
 * goals (a lone goal has nothing to reconcile), and there is no current plan to evolve from.
 * Exported so the gate is testable apart from the synthesis it guards.
 */
export function shouldFanout(opts: SynthesizeOpts): boolean {
  const evolving = Array.isArray(opts.currentPlan) && opts.currentPlan.length > 0;
  return cadenceConfig.aim.planFanout && opts.goals.length >= 2 && !evolving;
}

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
  // 1. Fan-out — draft the goals concurrently in bounded batches (DRAFT_CONCURRENCY), keyed by
  // goal for the coverage backstop. Bounded, not all-at-once: see the constant.
  const drafts: { goal: Goal; activities: Partial<Activity>[] }[] = [];
  // Counted as they RESOLVE, not as each batch completes: within a batch the goals finish on
  // wildly different clocks (79s, 97s and 179s in one measured run), and reporting only at the
  // batch boundary would throw away the two checkpoints in between — which are most of the
  // movement this stage has to offer.
  const total = opts.goals.length;
  let done = 0;
  opts.progress?.stage('drafting');
  opts.progress?.drafted(0, total);
  for (let i = 0; i < opts.goals.length; i += DRAFT_CONCURRENCY) {
    drafts.push(
      ...(await Promise.all(
        opts.goals.slice(i, i + DRAFT_CONCURRENCY).map((goal) =>
          draftPerGoal(userId, goal, opts).then((activities) => {
            opts.progress?.drafted(++done, total, goal.title);
            return { goal, activities };
          }),
        ),
      )),
    );
  }
  const allDrafts = drafts.flatMap((d) => d.activities);
  if (allDrafts.length === 0) return { status: 'vetoed', violations: ['fan-out produced no draft activities'] };

  // 2. Reduce — one coordinating synthesize primed with the drafts. Its rationale is the one kept:
  // it is the only call that saw the whole week, so only it can explain the whole shape.
  opts.progress?.stage('coordinating');
  const { normalized, note, rationale } = await runSynthesize(userId, opts, allDrafts);
  if (normalized.length === 0) return { status: 'vetoed', violations: ['reduce step returned no activities'] };

  // 3. Vet + coverage: recover any goal the reduce dropped from its OWN draft (no extra model call).
  const byGoal = new Map(drafts.map((d) => [d.goal.goal_id, d.activities]));
  return finalizeCoverage(userId, normalized, note, rationale, opts, async (missing) =>
    missing.flatMap((g) => byGoal.get(g.goal_id) ?? []),
  );
}

/**
 * The planning entry point every flow calls. Fan-out → reduce only when shouldFanout says so
 * (genesis, ≥2 goals, switch on); otherwise — every evolve included — the single call. Same
 * signature/return as synthesizeAndVet, so lock/replan are drop-in.
 */
export async function planSynthesize(userId: string, opts: SynthesizeOpts): Promise<SynthesizeResult> {
  if (shouldFanout(opts)) return synthesizeFanoutAndVet(userId, opts);
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
  // `onSaving` marks the moment synthesis has succeeded and the commit is about to land — the
  // plan_run record's 'saving' stage (services/plan-run.ts). A callback because this function is
  // the only place that moment exists; the caller cannot see between the two halves.
  opts: SynthesizeOpts & { goalIds: string[]; occurrenceDays?: number; onSaving?: () => void },
): Promise<CommitResult> {
  const s = await planSynthesize(userId, opts);
  if (s.status === 'vetoed') return { status: 'vetoed', violations: s.violations };
  opts.onSaving?.();
  return commitActivities(userId, {
    activities: s.activities!,
    note: s.note ?? '',
    rationale: s.rationale,
    goalIds: opts.goalIds,
    occurrenceDays: opts.occurrenceDays,
  });
}
