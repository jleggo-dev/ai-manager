/**
 * The replan + proposal routes — every endpoint that can start a plan SYNTHESIS. Moved out of
 * routes/plan.ts (size-capped, same reasoning as routes/plan-changes.ts) when they stopped being
 * thin pass-throughs: synthesis takes minutes, so these routes now run it behind the durable
 * plan_run record (services/plan-run.ts) instead of inside the request — reply 202, work in the
 * background, GET /plan/replan/pending is the poll that reports proposal | running | failed.
 * Mounted under /plan so the URLs read as if they lived there; paths are unchanged.
 */
import { Router, type Request, type Response } from 'express';
import { requireCadenceUser } from '../auth/middleware.ts';
import { replanPlan, confirmReplan, dismissReplan, REBASELINE_STEER } from '../services/replan.ts';
import { startReplanRun } from '../services/replan-start.ts';
import { launchPlanRun, planRunProgress, planRunStage, readPlanRun } from '../services/plan-run.ts';
import { sendPlanReadyPush } from '../services/plan-ready-push.ts';
import { enterEpisode } from '../services/episode.ts';
import { getUser, setPendingProposal, setPlanRun } from '../repos/users.ts';
import { confirmLock } from '../services/lock.ts';
import { getActivePlan } from '../repos/plans.ts';
import { BodyValidationError, parseBody, replanSteerBodySchema } from '../validation/body.ts';

const router = Router();
router.use(requireCadenceUser);

/**
 * POST /plan/replan/preview — the manual "Adjust my plan" button's first step: synthesize_plan
 * (evolving the current plan) → plan_vet → pending_plan, now as a BACKGROUND run. The old
 * blocking reply died at undici's 300s ceiling while the synthesis went on to succeed unheard,
 * and a repeat tap started a second full synthesis. Always 202: {running:true} when this tap
 * started the run, plus joined:true when a fresh run was already in flight (the tap joins it —
 * never re-fires). The client polls GET /plan/replan/pending for the outcome. 400 invalid body.
 * The launch itself lives in services/replan-start.ts — the coach's start_replan tool is the
 * second door onto the same run, and the two must not drift.
 */
router.post('/replan/preview', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const { steer } = parseBody(replanSteerBodySchema, req.body);
    const outcome = await startReplanRun(userId, steer);
    res.status(202).json(outcome === 'joined' ? { running: true, joined: true } : { running: true });
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[POST /plan/replan/preview]', err);
    res.status(500).json({ error: 'preview failed' });
  }
});

/**
 * GET /plan/replan/pending — the poll behind every background synthesis. Exactly one of:
 * { proposal } (the vetted result, ready to confirm) · { proposal: null, running: {stage,
 * startedAt} } · { proposal: null, failed: {message} } · { proposal: null } (nothing going on).
 * A stored pending_plan wins over a run record if both briefly exist — the artifact is the
 * answer, the record only narrates the wait.
 */
router.get('/replan/pending', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const user = await getUser(userId);
    const pending = user?.pending_plan;
    if (pending) {
      return void res.json({
        proposal: { activities: pending.activities, note: pending.note, rationale: pending.rationale },
      });
    }
    const run = readPlanRun(user);
    if (run?.status === 'running') {
      return void res.json({ proposal: null, running: { stage: run.stage, startedAt: run.startedAt } });
    }
    if (run?.status === 'failed') {
      return void res.json({ proposal: null, failed: { message: run.error } });
    }
    res.json({ proposal: null });
  } catch (err) {
    console.error('[GET /plan/replan/pending]', err);
    res.status(500).json({ error: 'failed to read pending proposal' });
  }
});

/** POST /plan/replan/preview/dismiss — discard the previewed adjustment; nothing changes. Also
 *  clears the run record, so a dismissed FAILURE stops answering the poll (and the next preview
 *  claims a clean slate). */
router.post('/replan/preview/dismiss', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    await dismissReplan(userId);
    await setPlanRun(userId, null);
    res.json({ ok: true });
  } catch (err) {
    console.error('[POST /plan/replan/preview/dismiss]', err);
    res.status(500).json({ error: 'dismiss failed' });
  }
});

/**
 * POST /plan/replan — commit the previewed adjustment. 200 committed (with a `note`) · 422
 * vetoed — including when the preview is no longer on file: confirming used to re-run a full
 * synthesis inline, silently; now it refuses and says to run the preview again.
 */
router.post('/replan', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const r = await confirmReplan(userId);
    res.status(r.status === 'committed' ? 200 : 422).json(r);
  } catch (err) {
    console.error('[POST /plan/replan]', err);
    res.status(500).json({ error: 'replan failed' });
  }
});

/**
 * POST /plan/proposal/accept — accept the coach's proactive proposal. Branches on the proposal's
 * `action` (Req 4): an `enter_disrupted` proposal starts a detour — synchronous, it is one quick
 * job call. Everything else (replan / rebaseline) is a full synthesize-and-COMMIT, minutes long,
 * so it runs through the same background machinery as the preview: 202 {running:true} (joined:true
 * when already in flight), poll GET /plan/replan/pending, and a push on the committed result —
 * the accept used to be a disabled button label with no recovery at all.
 */
router.post('/proposal/accept', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const user = await getUser(userId);
    const proposal = user?.pending_proposal ?? null;
    if (proposal?.action === 'enter_disrupted') {
      const r = await enterEpisode(userId, { type: proposal.episode_type ?? 'custom' });
      await setPendingProposal(userId, null);
      return void res
        .status(r ? 200 : 409)
        .json(r ? { status: 'entered_disrupted', episode: r.episode } : { status: 'no_plan' });
    }
    // 'rebaseline' steers a fresh-start synthesis (reassess after a long break); 'replan'/undefined
    // is the plain adaptive re-plan. Both commit + clear the proposal via replanPlan.
    const steer = proposal?.action === 'rebaseline' ? REBASELINE_STEER : undefined;
    const outcome = await launchPlanRun(userId, 'proposal_accept', async () => {
      const r = await replanPlan(userId, steer, (stage) => planRunStage(userId, stage));
      // The commit lands with nobody watching — the person accepted and was free to leave — so
      // the push is how the finished week reaches them. Keyed on the new plan so a retried
      // settle cannot double-ping (kind+target idempotency in plan-ready-push.ts).
      if (r.status === 'committed') {
        await sendPlanReadyPush(
          userId,
          'replan_committed',
          r.planId ?? `v${r.version}`,
          'Your new week is set',
          'Come take a look — nothing else changes until you say so.',
        );
      }
      return r;
    });
    res.status(202).json(outcome === 'joined' ? { running: true, joined: true } : { running: true });
  } catch (err) {
    console.error('[POST /plan/proposal/accept]', err);
    res.status(500).json({ error: 'accept failed' });
  }
});

/** POST /plan/proposal/dismiss — decline the proposal; the weekly gate will re-assess next week. */
router.post('/proposal/dismiss', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    await setPendingProposal(userId, null);
    res.json({ ok: true });
  } catch (err) {
    console.error('[POST /plan/proposal/dismiss]', err);
    res.status(500).json({ error: 'dismiss failed' });
  }
});

/**
 * POST /plan/lock — build and commit the FIRST week: the guardrail gate, the fan-out synthesis,
 * the vet, and the commit, as a BACKGROUND run.
 *
 * It lived in routes/plan.ts and answered 200 with the committed plan, which meant holding one
 * HTTP request open for the whole synthesis. That is the same shape this file was created to get
 * away from, and onboarding was simply the last flow still doing it: measured across every
 * synthesis on record a single phase spans 79s to 563s, so a median first build ran past the
 * point any phone would keep the connection — and the client was left polling to find out whether
 * a plan it could not see had happened.
 *
 * Always 202: {running:true}, plus joined:true when a run was already in flight (a second tap
 * joins it rather than starting a second minutes-long build). GET /plan/build is the poll.
 */
router.post('/lock', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const outcome = await launchPlanRun(userId, 'first_plan', () =>
      confirmLock(userId, undefined, planRunProgress(userId)),
    );
    res.status(202).json(outcome === 'joined' ? { running: true, joined: true } : { running: true });
  } catch (err) {
    console.error('[POST /plan/lock]', err);
    res.status(500).json({ error: 'lock failed' });
  }
});

/**
 * GET /plan/build — the poll behind the first build. Exactly one of: { committed: true } (it
 * landed; the plan itself is the answer) · { committed: false, running: {stage, startedAt,
 * drafted} } · { committed: false, failed: {message} } · { committed: false } (nothing going on).
 *
 * The committed plan wins over the run record if both briefly exist, for the same reason the
 * proposal does above: the artifact is the answer, the record only narrates the wait. `drafted`
 * rides along because stages alone leave minutes unaccounted for — the per-goal fan-out is the
 * only place inside the long stages with something real to count.
 */
router.get('/build', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    if (await getActivePlan(userId)) return void res.json({ committed: true });
    const run = readPlanRun(await getUser(userId));
    if (run?.status === 'running') {
      return void res.json({
        committed: false,
        running: { stage: run.stage, startedAt: run.startedAt, ...(run.drafted ? { drafted: run.drafted } : {}) },
      });
    }
    if (run?.status === 'failed') return void res.json({ committed: false, failed: { message: run.error } });
    res.json({ committed: false });
  } catch (err) {
    console.error('[GET /plan/build]', err);
    res.status(500).json({ error: 'failed to read build state' });
  }
});

export default router;
