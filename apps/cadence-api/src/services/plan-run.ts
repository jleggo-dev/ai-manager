import { claimPlanRun, setPlanRun, setPlanRunStage, PLAN_RUN_STALE_MINUTES, type PlanRun } from '../repos/users.ts';
import { runInBackground } from './background.ts';
import { sendPlanReadyPush } from './plan-ready-push.ts';
import type { CommitResult, PlanFlowResult } from './plan-synthesis.ts';

/**
 * The run machinery behind every background plan synthesis (Phase 0, docs/cadence/PLAN-CHANGES.md).
 *
 * Synthesis takes minutes and used to run inside one blocking HTTP request: the request died at
 * undici's 300s ceiling (discarding work that later SUCCEEDED), and a repeat tap re-fired the
 * whole pipeline — four concurrent rebuilds, measured in production. So the run now lives in a
 * durable record (`cadence.users.plan_run`, migration 0051) instead of a request: routes claim it
 * and reply 202 immediately, the work runs in the background, the client polls the record, and
 * every ending is recorded — success clears it, failure persists a message AND pushes, because a
 * failed background run that stays silent is the exact disease this exists to cure.
 */

/** How the run ends, seen by the client poll. Derived by readPlanRun — never stored directly. */
export type PlanRunState =
  | { status: 'running'; stage: NonNullable<PlanRun['stage']>; startedAt: string }
  | { status: 'failed'; error: string }
  | null;

/**
 * Start `work` as this user's one background plan run — or report that one is already going.
 * The claim is atomic in the database (claimPlanRun), so two concurrent taps cannot both start:
 * the loser gets 'joined' and the client simply polls the winner's record. 'joined' also covers
 * a fresh run of the OTHER kind — one synthesis at a time per user, whatever asked for it.
 *
 * Outcome handling is deliberately centralized here, not in the work functions: they already
 * report proposed/committed/vetoed, and every path must settle the record the same way or a
 * stuck 'running' becomes the new silent failure.
 */
export async function launchPlanRun(
  userId: string,
  kind: PlanRun['kind'],
  work: () => Promise<PlanFlowResult | CommitResult>,
): Promise<'started' | 'joined'> {
  const startedAt = new Date().toISOString();
  const claimed = await claimPlanRun(userId, { kind, status: 'running', started_at: startedAt });
  if (!claimed) return 'joined';
  runInBackground(`plan-run:${kind}`, settleRun(userId, kind, startedAt, work));
  return 'started';
}

/** Run the work and make sure the record tells the truth afterward, whatever happened. */
async function settleRun(
  userId: string,
  kind: PlanRun['kind'],
  startedAt: string,
  work: () => Promise<PlanFlowResult | CommitResult>,
): Promise<void> {
  try {
    const r = await work();
    if (r.status === 'proposed' || r.status === 'committed') {
      // The artifact (pending_plan / the new plan version) IS the success signal — the record
      // only exists to answer "is it still going, and if not, why not".
      await setPlanRun(userId, null);
      return;
    }
    // A veto is a real answer with real words — show those, joined, not a generic apology.
    const message =
      r.status === 'needs_focus'
        ? 'Too many goals at once — trim the list and try again.'
        : r.violations?.length
          ? r.violations.join('; ')
          : 'The plan check did not pass — try again.';
    await recordFailure(userId, kind, startedAt, message);
  } catch (err) {
    // A thrown error is logged in full for us but stored as plain words for the client — a stack
    // trace on a phone screen helps nobody, and the push already says what to do next.
    console.error(`[plan-run:${kind}]`, err);
    await recordFailure(userId, kind, startedAt, 'Something went wrong while I was reworking your week.');
  }
}

/**
 * Persist the failure AND push it. Persisting alone is not enough: the person was told they
 * could leave, so the record answers the poll when they come back, and the push is what brings
 * them back at all. Keyed on started_at so a retried settle cannot double-ping (the push layer's
 * kind+target idempotency).
 */
async function recordFailure(userId: string, kind: PlanRun['kind'], startedAt: string, message: string): Promise<void> {
  await setPlanRun(userId, { kind, status: 'failed', started_at: startedAt, error: message });
  await sendPlanReadyPush(
    userId,
    `${kind}_failed`,
    startedAt,
    "That didn't finish",
    'Something went wrong while I was reworking your week. Open Cadence to try again — nothing was lost.',
  );
}

/**
 * Report which stage the running work is in. Fire-and-forget by design — the work functions take
 * a `(stage) => void` callback so a stage stamp can never slow or fail the synthesis it narrates.
 * The write itself is guarded on status='running' (repos/users.ts), so a late stamp cannot
 * resurrect a settled run.
 */
export function planRunStage(userId: string, stage: NonNullable<PlanRun['stage']>): void {
  void setPlanRunStage(userId, stage).catch((err) => console.warn(`[plan-run] stage write failed:`, err));
}

/**
 * Derive the client-facing run state from a user row. A 'running' record older than
 * PLAN_RUN_STALE_MINUTES reads as failed: background work here cannot outlive its invocation, so
 * a run that old has no process behind it — telling the client "still running" forever would be
 * the frozen sheet all over again, just relocated. (claimPlanRun uses the same age cutoff, so a
 * record shown as failed is also already claimable for the retry it invites.)
 */
export function readPlanRun(row: { plan_run?: PlanRun | null } | null): PlanRunState {
  const run = row?.plan_run;
  if (!run) return null;
  if (run.status === 'failed') {
    return { status: 'failed', error: run.error ?? 'That run went quiet — try again.' };
  }
  const startedMs = Date.parse(run.started_at);
  const stale = !Number.isFinite(startedMs) || Date.now() - startedMs > PLAN_RUN_STALE_MINUTES * 60_000;
  if (stale) return { status: 'failed', error: 'That run went quiet — try again.' };
  // No stage yet just means the work hasn't reported one — it starts by reading.
  return { status: 'running', stage: run.stage ?? 'reading', startedAt: run.started_at };
}
