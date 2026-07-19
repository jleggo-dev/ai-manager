import { Router, type Request, type Response } from 'express';
import { requireCadenceUser } from '../auth/middleware.ts';
import { buildProgress } from '../services/progress.ts';
import { insertGoalEvent } from '../repos/goal-events.ts';
import { getGoal } from '../repos/goals.ts';

const router = Router();
router.use(requireCadenceUser);

/** GET /progress — the deterministic dashboard: goal cards + activity trends + history. */
router.get('/', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    res.json(await buildProgress(userId));
  } catch (err) {
    console.error('[GET /progress]', err);
    res.status(500).json({ error: 'failed to build progress' });
  }
});

/**
 * POST /progress/events — the manual "+1" on a count card ("finished Dune"). goal_id is
 * validated as the user's own; label required. (The other write path is parse-session-log.)
 */
router.post('/events', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  const label = typeof req.body?.label === 'string' ? req.body.label.trim().slice(0, 120) : '';
  const goalId = typeof req.body?.goal_id === 'string' ? req.body.goal_id : null;
  if (!label) return void res.status(400).json({ error: 'label required' });
  try {
    if (goalId && !(await getGoal(userId, goalId))) {
      return void res.status(404).json({ error: 'goal not found' });
    }
    const ev = await insertGoalEvent(userId, { goal_id: goalId, kind: 'completion', label });
    res.json(ev);
  } catch (err) {
    console.error('[POST /progress/events]', err);
    res.status(500).json({ error: 'failed to record' });
  }
});

export default router;
