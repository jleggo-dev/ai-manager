import { Router, type Request, type Response } from 'express';
import { requireCadenceUser } from '../auth/middleware.ts';
import { buildNextWeek } from '../services/week-build.ts';

const router = Router();
router.use(requireCadenceUser);

/**
 * POST /plan/week/build — "Just build my week" (check-in rebuild, step 6): the end-of-trail
 * card's trust path. Recommits the SAME activities the outgoing week already had as the next plan
 * version — no coach call, no synthesis, just the calendar rolling forward. See week-build.ts.
 *
 * Own route file (not routes/plan.ts — another agent is in it this wave), mounted at `/plan/week`
 * in app.ts alongside the other routers.
 *
 * 409 both ways the guard can fail: no active plan to rebuild from (`no_plan`), or the current
 * week genuinely isn't over yet (`not_due`) — this ends a week, it never skips ahead of one still
 * running.
 */
router.post('/build', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const result = await buildNextWeek(userId);
    res.status(result.status === 'committed' ? 200 : 409).json(result);
  } catch (err) {
    console.error('[POST /plan/week/build]', err);
    res.status(500).json({ error: 'could not build your next week' });
  }
});

export default router;
