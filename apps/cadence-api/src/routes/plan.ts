import { Router, type Request, type Response } from 'express';
import { requireCadenceUser } from '../auth/middleware.ts';
import { previewLock, confirmLock, dismissLock } from '../services/lock.ts';
import { replanPlan, previewReplan, confirmReplan, dismissReplan, REBASELINE_STEER } from '../services/replan.ts';
import { buildPlanView } from '../services/plan-view.ts';
import { assessIfDue } from '../services/situation.ts';
import { getOccurrenceDetail, prefetchImminentSessions } from '../services/session-generate.ts';
import { logOccurrence } from '../services/session-log.ts';
import { logAdhocActivity } from '../services/adhoc-log.ts';
import { enterEpisode, endEpisode } from '../services/episode.ts';
import { recordWeighIn } from '../services/weigh-in.ts';
import { setPendingProposal, getUser } from '../repos/users.ts';
import { setOccurrenceStatus } from '../repos/occurrences.ts';
import { recordCheckIn } from '../repos/check-ins.ts';
import {
  BodyValidationError,
  parseBody,
  replanSteerBodySchema,
  occurrenceLogBodySchema,
  adhocLogBodySchema,
  weighInBodySchema,
  occurrenceStatusBodySchema,
  episodeEnterBodySchema,
} from '../validation/body.ts';

const todayIso = (): string => {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())).toISOString().slice(0, 10);
};

const router = Router();
router.use(requireCadenceUser);

/**
 * GET /plan — the ongoing "Today / Your week" view (active plan + week occurrences + consistency
 * + any pending coach proposal). Also kicks off the weekly situation_assess gate in the
 * background (best-effort, fire-and-forget) — deterministic tripwires decide whether it even
 * calls the Broker; a proposal it stores shows up on the NEXT load, same pattern as ensureHorizon.
 */
router.get('/', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const view = await buildPlanView(userId);
    void assessIfDue(userId).catch((err) => console.error('[assessIfDue]', err));
    void prefetchImminentSessions(userId).catch((err) => console.error('[prefetch]', err));
    res.json(view);
  } catch (err) {
    console.error('[GET /plan]', err);
    res.status(500).json({ error: 'failed to load plan' });
  }
});

/**
 * POST /plan/replan/preview — the manual "Adjust my plan" button's first step: synthesize_plan
 * (evolving the current plan to fit recent activity) → plan_vet. Stores pending_plan; commits
 * NOTHING. The button previously committed directly with no consent moment of its own (unlike
 * the weekly proposal banner, which already shows a reason before Accept) — this closes that gap.
 * 200 proposed · 422 vetoed (no active goals / vet failed).
 */
router.post('/replan/preview', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const { steer } = parseBody(replanSteerBodySchema, req.body);
    const r = await previewReplan(userId, steer);
    res.status(r.status === 'proposed' ? 200 : 422).json(r);
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[POST /plan/replan/preview]', err);
    res.status(500).json({ error: 'preview failed' });
  }
});

/** POST /plan/replan/preview/dismiss — discard the previewed adjustment; nothing changes. */
router.post('/replan/preview/dismiss', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    await dismissReplan(userId);
    res.json({ ok: true });
  } catch (err) {
    console.error('[POST /plan/replan/preview/dismiss]', err);
    res.status(500).json({ error: 'dismiss failed' });
  }
});

/**
 * POST /plan/replan — commit the previewed adjustment (self-sufficient: runs preview inline
 * first if called with nothing on file, so this never breaks for a caller that skips the
 * preview step). 200 committed (with a `note`) · 422 vetoed.
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

/** POST /plan/proposal/accept — accept the coach's proactive proposal. Branches on the proposal's
 *  `action` (Req 4): an `enter_disrupted` proposal starts a detour; everything else re-plans (the
 *  original behavior). Accepting IS the commit; the proposal is cleared on success. */
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
    const r = await replanPlan(userId, steer);
    res.status(r.status === 'committed' ? 200 : 422).json(r);
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
 * POST /plan/episode — enter a disrupted episode (Req 4): an ADDITIVE overlay, base plan paused for
 * the window + lighter "do what you can" options added (via the disrupted_plan job). The base plan
 * resumes untouched on end. 200 with the episode · 400 bad body · 409 no committed plan to overlay.
 */
router.post('/episode', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const body = parseBody(episodeEnterBodySchema, req.body);
    const r = await enterEpisode(userId, body);
    if (!r) return void res.status(409).json({ error: 'no active plan to overlay' });
    res.json(r);
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[POST /plan/episode]', err);
    res.status(500).json({ error: 'enter episode failed' });
  }
});

/** POST /plan/episode/end — end the active episode; base plan resumes from today. Idempotent. */
router.post('/episode/end', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    res.json(await endEpisode(userId));
  } catch (err) {
    console.error('[POST /plan/episode/end]', err);
    res.status(500).json({ error: 'end episode failed' });
  }
});

/** POST /plan/checkin — the explicit "I'm here" (Req 4): showing up keeps the streak alive on a
 *  rough day, even with nothing completed. Idempotent per day. */
router.post('/checkin', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    await recordCheckIn(userId, todayIso());
    res.json({ ok: true });
  } catch (err) {
    console.error('[POST /plan/checkin]', err);
    res.status(500).json({ error: 'checkin failed' });
  }
});

/**
 * GET /plan/occurrences/:id — the session detail sheet: occurrence + activity + the coach's
 * concrete session (generated + cached on first open; gates in services/session.ts). 404 when
 * the id isn't this user's — including future rows a replan just deleted, which the client
 * renders as "this session moved with your new plan".
 */
router.get('/occurrences/:id', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const detail = await getOccurrenceDetail(userId, req.params.id as string);
    if (!detail) return void res.status(404).json({ error: 'occurrence not found' });
    res.json(detail);
  } catch (err) {
    console.error('[GET /plan/occurrences/:id]', err);
    res.status(500).json({ error: 'failed to load session' });
  }
});

/**
 * POST /plan/occurrences/adhoc — log something you DID that wasn't on the plan ("hotel yoga
 * class"). Lands as a done occurrence on the day (default today) so it counts toward consistency
 * + the streak (Req 4 honest logging). MUST precede `/occurrences/:id` so "adhoc" isn't parsed as
 * an id. 400 empty text · 409 no committed plan (or date out of range).
 */
router.post('/occurrences/adhoc', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const { text, date } = parseBody(adhocLogBodySchema, req.body);
    const r = await logAdhocActivity(userId, text, date);
    if (!r) return void res.status(409).json({ error: 'no active plan (or date out of range)' });
    res.json(r);
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[POST /plan/occurrences/adhoc]', err);
    res.status(500).json({ error: 'log failed' });
  }
});

/**
 * POST /plan/occurrences/:id/log — "how did it go?" in the user's own words. Parses to a
 * structured log (broker), stores it + rollups + provenance, marks done. A parse failure still
 * records their words verbatim (never lost). 400 empty text · 404 not this user's occurrence.
 */
router.post('/occurrences/:id/log', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const { text } = parseBody(occurrenceLogBodySchema, req.body);
    const r = await logOccurrence(userId, req.params.id as string, text);
    if (!r) return void res.status(404).json({ error: 'occurrence not found' });
    res.json(r);
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[POST /plan/occurrences/:id/log]', err);
    res.status(500).json({ error: 'log failed' });
  }
});

/**
 * POST /plan/occurrences/:id/weigh-in — deterministic weigh-in capture (no LLM): stores the
 * weight point on the occurrence (the weight time series) + updates baseline current.
 * 400 implausible/invalid · 404 not this user's weigh-in row.
 */
router.post('/occurrences/:id/weigh-in', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const { weight, unit } = parseBody(weighInBodySchema, req.body);
    const r = await recordWeighIn(userId, req.params.id as string, weight, unit);
    if (!r) return void res.status(404).json({ error: 'not a weigh-in occurrence (or implausible weight)' });
    res.json(r);
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[POST /plan/occurrences/:id/weigh-in]', err);
    res.status(500).json({ error: 'weigh-in failed' });
  }
});

/** POST /plan/occurrences/:id — check off (or un-check) a scheduled occurrence. */
router.post('/occurrences/:id', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const { status } = parseBody(occurrenceStatusBodySchema, req.body);
    await setOccurrenceStatus(userId, req.params.id as string, status);
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[POST /plan/occurrences]', err);
    res.status(500).json({ error: 'update failed' });
  }
});

/**
 * POST /plan/preview — capture → confirm → PREVIEW (spec §6.1, §C8.6): guardrail gate →
 * synthesize_plan (Coach) → plan_vet (Broker). Stores the vetted result as pending_plan;
 * commits NOTHING — suggest-never-auto-apply, so the user sees the proposed schedule before
 * anything goes live. POST /plan/lock applies it.
 *  200 proposed · 409 needs_focus (goal-cap) · 422 vetoed (no goals / vet failed).
 */
router.post('/preview', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const result = await previewLock(userId);
    const code = result.status === 'proposed' ? 200 : result.status === 'needs_focus' ? 409 : 422;
    res.status(code).json(result);
  } catch (err) {
    console.error('[POST /plan/preview]', err);
    res.status(500).json({ error: 'preview failed' });
  }
});

/** POST /plan/preview/dismiss — discard the previewed plan; the user goes back to adjust. */
router.post('/preview/dismiss', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    await dismissLock(userId);
    res.json({ ok: true });
  } catch (err) {
    console.error('[POST /plan/preview/dismiss]', err);
    res.status(500).json({ error: 'dismiss failed' });
  }
});

/**
 * POST /plan/lock — commit the previewed plan: activities + scheduled occurrences; flips
 * confirmed goals to committed. Self-sufficient if called without a prior /plan/preview (runs
 * the same gate + synthesis inline first) — see services/lock.ts.
 *  200 committed · 409 needs_focus (goal-cap) · 422 vetoed (no goals / vet failed).
 */
router.post('/lock', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const result = await confirmLock(userId);
    const code = result.status === 'committed' ? 200 : result.status === 'needs_focus' ? 409 : 422;
    res.status(code).json(result);
  } catch (err) {
    console.error('[POST /plan/lock]', err);
    res.status(500).json({ error: 'lock failed' });
  }
});

export default router;
