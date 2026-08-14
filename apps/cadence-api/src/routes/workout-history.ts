import { Router, type Request, type Response } from 'express';
import { requireCadenceUser } from '../auth/middleware.ts';
import { upsertWorkoutHistory } from '../repos/workout-history.ts';
import { BodyValidationError, parseBody } from '../validation/body.ts';
import { workoutHistoryBodySchema } from '../validation/health.ts';

const router = Router();
router.use(requireCadenceUser);

/**
 * POST /me/workout-history — the HealthKit door for workout ROWS (0033). The device re-pushes
 * its whole window alongside the digest refresh; the unique key makes that idempotent, so
 * `inserted` is the count of genuinely new sessions. Source is stamped SERVER-side: this
 * endpoint is only ever the healthkit door — strava and cadence rows have server-side writers.
 */
router.post('/workout-history', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const body = parseBody(workoutHistoryBodySchema, req.body);
    const inserted = await upsertWorkoutHistory(userId, 'healthkit', body.workouts);
    res.json({ ok: true, inserted });
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[POST /me/workout-history]', err);
    res.status(500).json({ error: 'failed to save workout history' });
  }
});

export default router;
