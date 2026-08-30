import { Router, type Request, type Response } from 'express';
import { requireCadenceUser } from '../auth/middleware.ts';
import { listGoalsByStatus } from '../repos/goals.ts';
import { getCommitted } from '../repos/progress-layouts.ts';
import { defaultLayout } from '../services/progress-layout.ts';

const router = Router();
router.use(requireCadenceUser);

/**
 * GET /me/progress-layout — the committed layout if the user (or, from Wave 3, the coach via the
 * progress talk) has set one; otherwise the deterministic default composed from their goals right
 * now. Never a model call — docs/cadence/PROGRESS-ENGINE.md "The layout model".
 */
router.get('/progress-layout', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const committed = await getCommitted(userId);
    if (committed) return void res.json(committed.layout);
    // Same goal statuses buildProgress uses: confirmed AND committed — a count goal is trackable
    // even before it produces plan activities, and replan-era goals can sit at confirmed indefinitely.
    const goals = await listGoalsByStatus(userId, ['confirmed', 'committed']);
    res.json(defaultLayout(goals));
  } catch (err) {
    console.error('[GET /me/progress-layout]', err);
    res.status(500).json({ error: 'failed to build progress layout' });
  }
});

export default router;
