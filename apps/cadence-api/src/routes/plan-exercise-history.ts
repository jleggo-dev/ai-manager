import { Router, type Request, type Response } from 'express';
import { requireCadenceUser } from '../auth/middleware.ts';
import { HISTORY_LINES_MAX, exerciseHistory } from '../services/exercise-history.ts';

/**
 * GET /plan/exercise-history?exercise=&activity=&limit= — the last few times the person logged one
 * exercise (services/exercise-history.ts). Its own file: a distinct read, and plan.ts is at the
 * size gate. 400 without an exercise name; otherwise `{ lines }`, newest first, possibly empty.
 */
const router = Router();
router.use(requireCadenceUser);

router.get('/exercise-history', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  const exercise = typeof req.query.exercise === 'string' ? req.query.exercise.trim() : '';
  if (!exercise) return void res.status(400).json({ error: 'exercise is required' });
  const activity =
    typeof req.query.activity === 'string' && req.query.activity.trim() ? req.query.activity.trim() : undefined;
  const limit = Math.min(HISTORY_LINES_MAX, Math.max(1, Number(req.query.limit) || 3));
  try {
    res.json({ lines: await exerciseHistory(userId, { exercise, activity, limit }) });
  } catch (err) {
    console.error('[GET /plan/exercise-history]', err);
    res.status(500).json({ error: 'failed to read exercise history' });
  }
});

export default router;
