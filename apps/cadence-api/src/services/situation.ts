import type { PendingProposal, SituationAssessResult } from '@cadence/shared';
import { getUser, setPendingProposal, touchAssessedAt } from '../repos/users.ts';
import { getActivePlan } from '../repos/plans.ts';
import { listGoalsByStatus } from '../repos/goals.ts';
import { listOccurrences } from '../repos/occurrences.ts';
import { rollingConsistency } from './metrics.ts';
import { detectTripwires, type TripwireSnapshot } from './tripwires.ts';
import { runJob } from '../ai/aim.ts';
import { cadenceConfig } from '../config.ts';

const ASSESS_INTERVAL_DAYS = 7;
const iso = (d: string | Date): string => new Date(d).toISOString().slice(0, 10);

function parseJson(text: string): Partial<SituationAssessResult> | null {
  try {
    return JSON.parse(text) as Partial<SituationAssessResult>;
  } catch {
    return null;
  }
}

/**
 * Deterministic snapshot (spec §B4) — no LLM, only signals the app can actually observe today:
 * rolling consistency, its week-over-week dip, and past-due-still-pending occurrences read as
 * "missed" (the `missed` occurrence status is never written by anything yet). Timezone/location/
 * weather aren't wired to a live signal, so those fields stay undefined — detectTripwires guards
 * every check on `!= null`, so they simply never fire rather than firing on stale defaults.
 */
async function buildSnapshot(userId: string): Promise<TripwireSnapshot> {
  const user = await getUser(userId);
  const missedThreshold = user?.steer_back?.missed_threshold ?? 3;

  const now = new Date();
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const occ = await listOccurrences(userId, iso(new Date(base - 13 * 86_400_000)), iso(new Date(base)));

  const last7 = rollingConsistency(occ, now, 7);
  const prev7 = rollingConsistency(occ, new Date(base - 7 * 86_400_000), 7);
  const missedCount = occ.filter((o) => o.status === 'pending' && iso(o.date) < iso(new Date(base))).length;

  return {
    missedCount,
    missedThreshold,
    // A meaningful dip, not noise: was showing up most days, now down by 2+ — a fresh plan's
    // empty prior window (prev7.kept === 0) correctly never trips this.
    consistencyDropped: prev7.kept >= 4 && last7.kept <= prev7.kept - 2,
  };
}

/**
 * Session-start assessment (spec §B4), gated to run at most weekly per user. The deterministic
 * tripwires are the ONLY gate on the Broker call — empty means no LLM call at all. When
 * situation_assess recommends a re-plan, it's stored as a pending proposal for the user to accept
 * or dismiss from the plan view; it is never auto-applied (suggest-never-auto-apply).
 */
export async function assessIfDue(userId: string): Promise<void> {
  const user = await getUser(userId);
  if (!user) return;
  if (user.pending_proposal) return; // one's already outstanding — wait for accept/dismiss

  const lastAssessed = user.last_assessed_at ? new Date(user.last_assessed_at).getTime() : 0;
  if (Date.now() - lastAssessed < ASSESS_INTERVAL_DAYS * 86_400_000) return;

  const plan = await getActivePlan(userId);
  if (!plan) return; // nothing to assess before a plan exists

  // Monthly rebuild checkpoint (deterministic, no LLM): after ~4 weeks the progression engine has
  // been evolving a deterministic-mode plan on its own — offer a coach rebuild for the next block.
  // Reuses the pending_proposal → accept-runs-replan machinery; the pending guard above stops it
  // re-firing until acted on (re-offers the following week if dismissed while still a month in).
  const planAgeDays = (Date.now() - new Date(plan.generated_at).getTime()) / 86_400_000;
  if (planAgeDays >= 28) {
    const goals = await listGoalsByStatus(userId, ['committed']);
    if (goals.some((g) => g.plan_mode === 'deterministic')) {
      await touchAssessedAt(userId);
      await setPendingProposal(userId, {
        reason: "You've held this rhythm about a month — want me to take a fresh look and build your next block?",
        suggested_levers: ['Build my next block'],
        created_at: new Date().toISOString(),
      });
      return;
    }
  }

  const snapshot = await buildSnapshot(userId);
  const fired = detectTripwires(snapshot);
  await touchAssessedAt(userId); // gate advances whether or not anything fired

  if (fired.length === 0) return;

  const res = await runJob(userId, cadenceConfig.aim.jobs.situationAssess, {
    snapshot: JSON.stringify({ ...snapshot, fired }),
  });
  const out = parseJson(res.formatted ?? res.raw ?? '');
  if (!out?.recommend_replan) return;

  const proposal: PendingProposal = {
    reason:
      typeof out.reason === 'string' && out.reason.trim()
        ? out.reason.trim()
        : 'Your coach noticed a shift worth adjusting for.',
    suggested_levers: Array.isArray(out.suggested_levers)
      ? out.suggested_levers.filter((l): l is string => typeof l === 'string')
      : [],
    created_at: new Date().toISOString(),
  };
  await setPendingProposal(userId, proposal);
}
