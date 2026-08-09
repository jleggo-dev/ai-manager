import { Router, type Request, type Response } from 'express';
import type { CheckinAdjustment, MoodValue } from '@cadence/shared';
import { requireCadenceUser } from '../auth/middleware.ts';
import { getUser, setCoachFaceId } from '../repos/users.ts';
import { getDailyCheckin, saveDailyCheckin, saveSessionFeedback } from '../repos/coach-moments.ts';
import { getDailyCheckinStatus } from '../services/daily-checkin.ts';
import { BodyValidationError, parseBody } from '../validation/body.ts';
import { coachFaceBodySchema, dailyCheckinBodySchema, sessionFeedbackBodySchema } from '../validation/coach-moments.ts';

/**
 * The coach's face, and the two moments that capture how things felt. Mounted under /me — these
 * are all facts about the person, not about the plan.
 *
 * Note what is NOT here: nothing in this router changes a plan. The check-in's adjustment is
 * recorded as an intent and handed back to the client, which then walks the ordinary
 * suggest→preview→confirm flow. A moment that could silently reshape someone's week would be the
 * one place in Cadence where the plan moves without being shown first.
 */
const router = Router();
router.use(requireCadenceUser);

/** GET /me/coach-face — the picked portrait, or null for "hasn't picked" (renders the brand mark). */
router.get('/coach-face', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const user = await getUser(userId);
    res.json({ face_id: user?.coach_face_id ?? null });
  } catch (err) {
    console.error('[GET /me/coach-face]', err);
    res.status(500).json({ error: 'failed to load coach face' });
  }
});

/**
 * PUT /me/coach-face — pick a portrait (or clear it with null). Touches nothing else by design:
 * plan, history and signals are all untouched, which is what makes the Settings copy ("your plan
 * and history stay put") literally true rather than a reassurance.
 */
router.put('/coach-face', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const { face_id } = parseBody(coachFaceBodySchema, req.body);
    await setCoachFaceId(userId, face_id);
    res.json({ face_id });
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[PUT /me/coach-face]', err);
    res.status(500).json({ error: 'failed to save coach face' });
  }
});

/**
 * POST /me/session-feedback — how a session felt. Best-effort by contract: the client fires this
 * after the celebration is already on screen, and a failure must never cost someone their
 * completed session, so the response is thin and the client ignores it.
 */
router.post('/session-feedback', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const body = parseBody(sessionFeedbackBodySchema, req.body);
    await saveSessionFeedback(userId, {
      occurrenceId: body.occurrence_id ?? null,
      kind: body.kind,
      rpe: body.rpe ?? null,
      feltState: body.felt_state ?? null,
      reasonCode: body.reason_code ?? null,
    });
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[POST /me/session-feedback]', err);
    res.status(500).json({ error: 'failed to save feedback' });
  }
});

/**
 * GET /me/daily-checkin — should Cadence ask about yesterday? All four gates live server-side
 * (services/daily-checkin.ts) because they turn on the user's timezone and yesterday's plan,
 * neither of which the client should be re-deriving.
 */
router.get('/daily-checkin', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    res.json(await getDailyCheckinStatus(userId));
  } catch (err) {
    console.error('[GET /me/daily-checkin]', err);
    // A broken gate must fail CLOSED — an unwanted prompt is worse than a missed one.
    res.json({ due: false, date: null, reviewing: null });
  }
});

/**
 * POST /me/daily-checkin — record mood, an adjustment intent, or "Not now". Returns the row so the
 * client can confirm what stuck. The adjustment is an INTENT: the client takes the matching steer
 * to the normal adjust flow, and nothing has moved when this responds.
 */
router.post('/daily-checkin', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const body = parseBody(dailyCheckinBodySchema, req.body);
    const { date } = await getDailyCheckinStatus(userId);
    await saveDailyCheckin(userId, date, {
      mood: (body.mood ?? null) as MoodValue | null,
      adjustment: (body.adjustment ?? null) as CheckinAdjustment | null,
      dismissed: body.dismissed === true,
    });
    res.json(await getDailyCheckin(userId, date));
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[POST /me/daily-checkin]', err);
    res.status(500).json({ error: 'failed to save check-in' });
  }
});

export default router;
