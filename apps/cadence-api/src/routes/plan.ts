import { Router, type Request, type Response } from 'express';
import { requireCadenceUser } from '../auth/middleware.ts';
import { previewLock, confirmLock, dismissLock } from '../services/lock.ts';
import { replanPlan, previewReplan, confirmReplan, dismissReplan, REBASELINE_STEER } from '../services/replan.ts';
import { buildPlanView } from '../services/plan-view.ts';
import { assessIfDue } from '../services/situation.ts';
import { getOccurrenceDetail, prefetchImminentSessions } from '../services/session-generate.ts';
import { logOccurrence } from '../services/session-log.ts';
import { logAdhocActivity, logPlannedActivity } from '../services/adhoc-log.ts';
import { enterEpisode, endEpisode, reviseEpisodeEquipment, postponeEpisodeStart } from '../services/episode.ts';
import { equipmentFromGymPhotos } from '../services/gym-photo.ts';
import { recordWeighIn, recordWeighInToday } from '../services/weigh-in.ts';
import { getSessionInsight } from '../services/session-insight.ts';
import { setPendingProposal, setPendingPlan, getUser } from '../repos/users.ts';
import { setOccurrenceStatus, getOccurrenceWithActivity } from '../repos/occurrences.ts';
import { recordCheckIn } from '../repos/check-ins.ts';
import {
  BodyValidationError,
  parseBody,
  replanSteerBodySchema,
  occurrenceLogBodySchema,
  adhocLogBodySchema,
  didLogBodySchema,
  weighInBodySchema,
  occurrenceStatusBodySchema,
  episodeEnterBodySchema,
  episodePhotoBodySchema,
  episodeEquipmentBodySchema,
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
/** The caller's IANA zone, when the client sent one. Never trusted over the stored value. */
function tzHint(req: Request): string | null {
  const h = req.header('X-Cadence-Timezone');
  return h && h.length < 64 ? h : null;
}

router.get('/', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    // The client's own zone, used only when the user has none stored. The screen's idea of
    // "today" must be the person's, not the server's (see buildPlanView).
    const view = await buildPlanView(userId, 7, tzHint(req));
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

/**
 * GET /plan/replan/pending — the stored pending proposal, if one is on file. The recovery half of
 * the leave-safe rebuild: previewReplan persists its vetted result as `pending_plan` the moment
 * synthesis finishes, so a phone whose fetch died mid-preview (backgrounded, signal lost) polls
 * THIS on return instead of paying for a second synthesis — or worse, reporting a failure for a
 * proposal that is sitting right there. 200 { proposal } · 200 { proposal: null } when none.
 */
router.get('/replan/pending', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const pending = (await getUser(userId))?.pending_plan;
    res.json(
      pending
        ? { proposal: { activities: pending.activities, note: pending.note, rationale: pending.rationale } }
        : { proposal: null },
    );
  } catch (err) {
    console.error('[GET /plan/replan/pending]', err);
    res.status(500).json({ error: 'failed to read pending proposal' });
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

/**
 * POST /plan/episode/equipment-photo — the equipment answer as pictures (PLAN §424): parse what
 * the gym photos show and re-draft the detour's remaining days around it. 409 without an active
 * episode — the photo only means something inside one.
 */
router.post('/episode/equipment-photo', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const body = parseBody(episodePhotoBodySchema, req.body);
    const r = await equipmentFromGymPhotos(userId, body.photos);
    if (r.reason === 'no_episode') return void res.status(409).json({ error: 'no active detour' });
    res.json(r);
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[POST /plan/episode/equipment-photo]', err);
    res.status(500).json({ error: 'could not read the photo' });
  }
});

/**
 * POST /plan/episode/equipment — the equipment answer in words, from the arrival card's chips:
 * the same revision machine the conversational and photo doors feed. An empty list is a real
 * answer ("no gym here") and re-drafts to equipment-free days.
 */
router.post('/episode/equipment', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const body = parseBody(episodeEquipmentBodySchema, req.body);
    const r = await reviseEpisodeEquipment(userId, body.equipment);
    if (r.reason === 'no_episode') return void res.status(409).json({ error: 'no active detour' });
    res.json(r);
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[POST /plan/episode/equipment]', err);
    res.status(500).json({ error: 'could not update the detour' });
  }
});

/**
 * POST /plan/episode/not-yet — arrival day, but they haven't arrived: push the start one day.
 * Today's shelved sessions come back; the end stays put; pushing past the end cancels.
 */
router.post('/episode/not-yet', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    res.json(await postponeEpisodeStart(userId));
  } catch (err) {
    console.error('[POST /plan/episode/not-yet]', err);
    res.status(500).json({ error: 'could not postpone' });
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
 * GET /plan/occurrences/:id/insight — the ONE thing Cadence noticed about this session, or null.
 *
 * Deliberately separate from the detail fetch above rather than folded into it: the detail call
 * may generate the session (an LLM round-trip, seconds), while this is two indexed reads. Split,
 * the insight card is on screen the moment the sheet opens instead of popping in late. A failure
 * resolves to `null` — an absent insight is a normal outcome, not an error worth showing.
 */
router.get('/occurrences/:id/insight', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const occ = await getOccurrenceWithActivity(userId, req.params.id as string);
    if (!occ) return void res.status(404).json({ error: 'occurrence not found' });
    res.json({ insight: await getSessionInsight(userId, occ) });
  } catch (err) {
    console.error('[GET /plan/occurrences/:id/insight]', err);
    res.json({ insight: null });
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
 * POST /plan/activities/:id/did — the goal-aware "＋" (log something you did): credit a PLANNED
 * activity you actually did as a done occurrence for the day (default today), so it counts toward
 * that goal + consistency/streak even if it was scheduled for another day ("did Thursday's workout
 * today"). 400 bad body · 404 not this user's activity (or date out of range).
 */
router.post('/activities/:id/did', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const { text, date } = parseBody(didLogBodySchema, req.body);
    const r = await logPlannedActivity(userId, req.params.id as string, text, date);
    if (!r) return void res.status(404).json({ error: 'activity not found (or date out of range)' });
    res.json(r);
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[POST /plan/activities/:id/did]', err);
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

/**
 * POST /plan/weigh-in — today's weight, on any day (A23 §2c).
 *
 * The occurrence-scoped route above is for the scheduled weigh-in; this one is for someone who
 * has opted into weighing daily. Same validation, same series, same history — it just gets today's
 * occurrence created for it. 404 when their plan has no weigh-in to hang it off.
 */
router.post('/weigh-in', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const { weight, unit } = parseBody(weighInBodySchema, req.body);
    const r = await recordWeighInToday(userId, weight, unit);
    if (!r) return void res.status(404).json({ error: 'no weigh-in on your plan (or implausible weight)' });
    res.json(r);
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[POST /plan/weigh-in]', err);
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

/**
 * GET /plan/pending-change — the change the coach has PROPOSED but nobody has applied.
 *
 * The card reads its content from here rather than from the turn that announced it, so what the
 * user is asked to agree to is what `propose_plan_change` actually computed. A turn describing
 * the change loosely (or wrongly) cannot alter what commits.
 */
router.get('/pending-change', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const pending = (await getUser(userId))?.pending_plan;
    if (!pending?.rationale) return void res.json({ change: null });
    res.json({
      change: {
        changes: pending.rationale.split('\n').filter(Boolean),
        activities: pending.activities.length,
        created_at: pending.created_at,
      },
    });
  } catch (err) {
    console.error('[GET /plan/pending-change]', err);
    res.json({ change: null });
  }
});

/** POST /plan/pending-change/dismiss — "not now". Drops the proposal; the plan is untouched. */
router.post('/pending-change/dismiss', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    await setPendingPlan(userId, null);
    res.json({ ok: true });
  } catch (err) {
    console.error('[POST /plan/pending-change/dismiss]', err);
    res.status(500).json({ error: 'dismiss failed' });
  }
});

export default router;
