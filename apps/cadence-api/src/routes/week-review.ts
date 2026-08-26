/**
 * The Week review pending-surface pair — split out of plan.ts (already at its size gate) rather
 * than grown inside it, the same way coach-food.ts sits beside coach.ts. Mounted under /plan so the
 * URLs read exactly as if they lived there: GET /plan/week-review/pending, POST
 * /plan/week-review/dismiss.
 *
 * Mirrors the /plan/pending-change pair precisely: the coach's `open_week_review` tool
 * (coach-action-week-review.ts) is the only writer, the client polls this GET on a finished turn,
 * and renders a labelled card from whatever it finds — never from the turn's own prose.
 */
import { Router, type Request, type Response } from 'express';
import { requireCadenceUser } from '../auth/middleware.ts';
import { getUser, setPendingWeekReview } from '../repos/users.ts';

const router = Router();
router.use(requireCadenceUser);

/**
 * GET /plan/week-review/pending — the plan week `open_week_review` last put up, if the user
 * hasn't opened or dismissed it yet. The card reads its content from here rather than from the
 * turn that announced it, same reasoning as pending-change: what the screen shows is what the tool
 * actually computed, not what a reply claimed.
 */
router.get('/week-review/pending', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const review = (await getUser(userId))?.pending_week_review ?? null;
    res.json({ review });
  } catch (err) {
    console.error('[GET /plan/week-review/pending]', err);
    res.json({ review: null });
  }
});

/** POST /plan/week-review/dismiss — clears the pointer. Nothing else was ever written by
 *  opening or dismissing it, so there is nothing else to undo. */
router.post('/week-review/dismiss', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    await setPendingWeekReview(userId, null);
    res.json({ ok: true });
  } catch (err) {
    console.error('[POST /plan/week-review/dismiss]', err);
    res.status(500).json({ error: 'dismiss failed' });
  }
});

export default router;
