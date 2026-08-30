import { Router, type Request, type Response } from 'express';
import type { ProgressWindow } from '@cadence/shared';
import { requireCadenceUser } from '../auth/middleware.ts';
import { listWorkoutHistory, upsertWorkoutHistory } from '../repos/workout-history.ts';
import { autoTickFromWorkouts } from '../services/workout-autotick.ts';
import { resolveDatedSessions } from '../services/progress-sessions.ts';
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
    // A recorded workout completes the session it was planned for. Awaited, not fire-and-forget
    // (#195): the tick must land before the handler returns or the platform may never finish it.
    const ticked = await autoTickFromWorkouts(userId, body.workouts).catch((e) => {
      console.error('[workout-history] auto-tick failed (rows are saved regardless)', e);
      return 0;
    });
    res.json({ ok: true, inserted, ticked });
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[POST /me/workout-history]', err);
    res.status(500).json({ error: 'failed to save workout history' });
  }
});

/**
 * GET /me/workout-history — the client-facing read the door was always missing (repo fn
 * `listWorkoutHistory` predates this route; only coach retrieval called it). Newest first,
 * bounded on both ends so a long-lived account can't ask for an unbounded scan or payload.
 */
router.get('/workout-history', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const days = Math.min(1825, Math.max(1, Number(req.query.days) || 90));
    const limit = Math.min(300, Math.max(1, Number(req.query.limit) || 60));
    const workouts = await listWorkoutHistory(userId, days, limit);
    res.json({ workouts });
  } catch (err) {
    console.error('[GET /me/workout-history]', err);
    res.status(500).json({ error: 'failed to load workout history' });
  }
});

const WINDOWS: ProgressWindow[] = ['week', 'month', 'all'];

/**
 * GET /me/sessions?activity=&window= — the `dated_sessions` widget's binding resolver (Progress
 * Engine W1-3): plan sessions (occurrences, keyed by activity TITLE — the cross-plan history key)
 * merged with raw workout_history rows, deduped where a HealthKit auto-tick means the same
 * workout produced both. See services/progress-sessions.ts for the merge/dedupe/best/usual_hr
 * rules. `activity` is required — an empty binding has nothing to show and nothing to dedupe.
 */
router.get('/sessions', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  const activity = typeof req.query.activity === 'string' ? req.query.activity.trim() : '';
  if (!activity) return void res.status(400).json({ error: 'activity is required' });
  const rawWindow = typeof req.query.window === 'string' ? req.query.window : '';
  const window: ProgressWindow = (WINDOWS as string[]).includes(rawWindow) ? (rawWindow as ProgressWindow) : 'all';
  try {
    res.json(await resolveDatedSessions(userId, activity, window));
  } catch (err) {
    console.error('[GET /me/sessions]', err);
    res.status(500).json({ error: 'failed to load sessions' });
  }
});

export default router;
