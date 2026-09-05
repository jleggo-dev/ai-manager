/**
 * The questionnaire card's two routes — read what is up, and clear it once they have answered.
 *
 * Its own router mounted at '/coach' beside routes/coach.ts and coach-food.ts, the same pattern
 * '/progress' already uses for several: coach.ts is a large file about streaming a turn, and this
 * is a small pointer with a different lifetime.
 *
 * Neither route writes an answer, and there is no route that could. `send_questionnaire` stores
 * the QUESTIONS (cadence.users.pending_questionnaire, migration 0057) because the chat wire is
 * pure SSE prose and a tool call never reaches the browser; the answers leave the card as an
 * ordinary user message on the ordinary send path, so the coach reads what the person can see they
 * said. A submit endpoint here would be a second, invisible way of knowing things about someone.
 */
import { Router, type Request, type Response } from 'express';
import { requireCadenceUser } from '../auth/middleware.ts';
import { getPendingQuestionnaire, setPendingQuestionnaire } from '../repos/users.ts';

const router = Router();
router.use(requireCadenceUser);

/**
 * GET /coach/questionnaire — the questions standing right now, or null.
 *
 * A card is not worth a broken conversation, so a failed read answers "nothing up" (200) rather
 * than a status the chat surface would have to handle: her prose already said the questions were
 * coming, and the honest fallback is a missing card, not an error over the thread.
 */
router.get('/questionnaire', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    res.json({ questionnaire: await getPendingQuestionnaire(userId) });
  } catch (err) {
    console.error('[GET /coach/questionnaire]', err);
    res.json({ questionnaire: null });
  }
});

/**
 * POST /coach/questionnaire/clear — they answered, or they put it aside.
 *
 * Both answers land here, and neither has anything else to undo: offering stored only the
 * questions. A failure is reported rather than swallowed, because a clear that quietly did nothing
 * puts the same card back on the next turn after they already sent it.
 */
router.post('/questionnaire/clear', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    await setPendingQuestionnaire(userId, null);
    res.json({ ok: true });
  } catch (err) {
    console.error('[POST /coach/questionnaire/clear]', err);
    res.status(500).json({ error: 'clear failed' });
  }
});

export default router;
