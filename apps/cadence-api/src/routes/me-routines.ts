import { Router, type Request, type Response } from 'express';
import { requireCadenceUser } from '../auth/middleware.ts';
import {
  listUserRoutines,
  createUserRoutine,
  updateUserRoutine,
  deleteUserRoutine,
  runUserRoutine,
  scheduleUserRoutine,
  unscheduleUserRoutine,
} from '../services/user-routines.ts';
import {
  BodyValidationError,
  parseBody,
  createUserRoutineBodySchema,
  updateUserRoutineBodySchema,
  scheduleUserRoutineBodySchema,
} from '../validation/body.ts';

/**
 * /me/routines — the user-routines store (Activity Builder wave 3): the server half of the
 * CONTRACT authored in apps/cadence-web/src/lib/api/user-routines.ts. These routes implement that
 * file verbatim — paths, methods, response shapes, and failure semantics — so read it first if a
 * shape here looks surprising; it is the source of truth, not this file.
 */
const router = Router();
router.use(requireCadenceUser);

/** GET /me/routines — everything the user has built, newest first. */
router.get('/routines', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    res.json({ routines: await listUserRoutines(userId) });
  } catch (err) {
    console.error('[GET /me/routines]', err);
    res.status(500).json({ error: 'failed to load routines' });
  }
});

/** POST /me/routines — save a newly built routine. 400 when the session doesn't normalize to
 *  anything usable (services/session-normalize.ts's `normalizeSession`, the coach's own bounds). */
router.post('/routines', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const body = parseBody(createUserRoutineBodySchema, req.body);
    const routine = await createUserRoutine(userId, body);
    if (!routine) return void res.status(400).json({ error: 'session did not contain any usable steps' });
    res.json(routine);
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[POST /me/routines]', err);
    res.status(500).json({ error: 'create failed' });
  }
});

/** PATCH /me/routines/:id — edit name/steps. 404 not this user's · 400 a malformed session. */
router.patch('/routines/:id', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const body = parseBody(updateUserRoutineBodySchema, req.body);
    const result = await updateUserRoutine(userId, req.params.id as string, body);
    if (!result.ok) return void res.status(result.status).json({ error: 'update failed' });
    res.json(result.routine);
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[PATCH /me/routines]', err);
    res.status(500).json({ error: 'update failed' });
  }
});

/** DELETE /me/routines/:id — remove the routine; its companion activity + occurrence history
 *  survive (revert to unscheduled). 404 when it isn't this user's. */
router.delete('/routines/:id', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const ok = await deleteUserRoutine(userId, req.params.id as string);
    if (!ok) return void res.status(404).json({ error: 'routine not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /me/routines]', err);
    res.status(500).json({ error: 'delete failed' });
  }
});

/** POST /me/routines/:id/run — credit one completed off-plan run. 404 not this user's · 409 no
 *  active plan to attach the companion activity to. */
router.post('/routines/:id/run', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const result = await runUserRoutine(userId, req.params.id as string);
    if (!result.ok) return void res.status(result.status).json({ error: 'run failed' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[POST /me/routines/:id/run]', err);
    res.status(500).json({ error: 'run failed' });
  }
});

/** POST /me/routines/:id/schedule — "put it on the plan": day chips + a time-of-day, written
 *  deterministically. 404 not this user's · 409 no active plan. */
router.post('/routines/:id/schedule', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const body = parseBody(scheduleUserRoutineBodySchema, req.body);
    const result = await scheduleUserRoutine(userId, req.params.id as string, body);
    if (!result.ok) return void res.status(result.status).json({ error: 'schedule failed' });
    res.json({ ok: true });
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[POST /me/routines/:id/schedule]', err);
    res.status(500).json({ error: 'schedule failed' });
  }
});

/** DELETE /me/routines/:id/schedule — take it off the plan; the routine stays in the library. */
router.delete('/routines/:id/schedule', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const result = await unscheduleUserRoutine(userId, req.params.id as string);
    if (!result.ok) return void res.status(result.status).json({ error: 'unschedule failed' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /me/routines/:id/schedule]', err);
    res.status(500).json({ error: 'unschedule failed' });
  }
});

export default router;
