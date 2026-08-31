import { previewReplan } from './replan.ts';
import { sendPlanReadyPush } from './plan-ready-push.ts';
import { logAi } from './ai-log.ts';
import { runInBackground } from './background.ts';
import { cadenceConfig } from '../config.ts';
import type { PlanFlowResult } from './plan-synthesis.ts';

/**
 * The steered rebalance, made durable and observable — the two things its first day proved it
 * was not (2026-08-31, ~11:41): the coach's `rebalance_week` fired `previewReplan` through
 * `runInBackground`, the serverless invocation froze mid-synthesis (~3 minutes in, per the
 * ai_log fan-out rows), and the user got SILENCE — no card, no push, no error, while the coach
 * had said a rebalance was on its way. Fire-and-forget discards outcomes, and a minutes-long
 * job cannot ride waitUntil inside a chat turn's invocation.
 *
 * Two halves:
 *  - `runSteeredRebalance` — the work plus its audit trail: every outcome lands in ai_log, and a
 *    veto or crash sends the same transactional "come talk to me" push that success sends, so no
 *    outcome is ever silent. previewReplan itself already pushes the ready ping on success.
 *  - `dispatchRebalance` — the transport: on Vercel, a self-request to /internal/plan/rebalance
 *    gives the synthesis its OWN invocation (the same lifetime the app's Adjust button has always
 *    had, where the client holds the request open); locally, where nothing freezes, it just runs
 *    in-process. The chat turn only pays for dispatching.
 */
export async function runSteeredRebalance(userId: string, steer: string): Promise<PlanFlowResult> {
  try {
    const r = await previewReplan(userId, steer);
    void logAi(userId, {
      kind: 'rebalance_week',
      input: { steer },
      output: r.status === 'vetoed' ? { status: r.status, violations: r.violations } : { status: r.status },
    }).catch(() => {});
    if (r.status === 'vetoed') await pushRebalanceFailed(userId);
    return r;
  } catch (e) {
    void logAi(userId, {
      kind: 'rebalance_week',
      input: { steer },
      output: { status: 'error', error: String(e) },
    }).catch(() => {});
    await pushRebalanceFailed(userId);
    return { status: 'vetoed', violations: [String(e)] };
  }
}

/** The other half of "you can walk away": if the week can't be drawn, say so — never silence. */
async function pushRebalanceFailed(userId: string): Promise<void> {
  await sendPlanReadyPush(
    userId,
    'rebalance_failed',
    new Date().toISOString(),
    "That week didn't come together",
    "I couldn't draw the rebalanced week just now — come tell me and I'll try again.",
  ).catch((e) => console.error('[rebalance] failure push failed too:', e));
}

/** Where this deployment can reach itself. Explicit override first; Vercel's env second. */
function selfBase(): string | null {
  const explicit = process.env.CADENCE_SELF_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL ?? process.env.VERCEL_URL;
  return vercel ? `https://${vercel}` : null;
}

/**
 * Start the rebalance without making the caller's invocation carry it. Self-request when this
 * deployment can address itself AND the internal gate has a secret; in-process otherwise (local
 * dev and tests, where the process outlives the work). Either way the caller returns immediately.
 */
export function dispatchRebalance(userId: string, steer: string): void {
  const base = selfBase();
  if (base && cadenceConfig.cronSecret) {
    runInBackground(
      'rebalance_week dispatch',
      fetch(`${base}/internal/plan/rebalance`, {
        method: 'POST',
        headers: { authorization: `Bearer ${cadenceConfig.cronSecret}`, 'content-type': 'application/json' },
        body: JSON.stringify({ userId, steer }),
      }),
    );
    return;
  }
  runInBackground('rebalance_week', runSteeredRebalance(userId, steer));
}
