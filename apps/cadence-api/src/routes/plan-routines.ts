import { Router, type Request, type Response } from 'express';
import { requireCadenceUser } from '../auth/middleware.ts';
import { listRoutines, parseAreaParam, getRoutineSession } from '../services/routines.ts';

/**
 * GET /plan/routines — the user's coach-built routines: plan activities grouped by
 * `commitment_id` LINEAGE across every plan version (a lineage counts only when its LATEST
 * version is `kind = 'user'` — see services/routines.ts), the read side of Activity Builder A3 ("the
 * coach's sessions as the template library" — design-request-v2/activity-builder.txt, §"2A ·
 * Build — start from"). Its own file rather than another handler on `plan.ts`: plan.ts is already
 * close to the size gate, and this is a distinct read shape (grouped by lineage across every plan
 * version, not by one date window or one plan's activities) — same reasoning plan-watch.ts gives.
 *
 * `?area=movement|nourishment|mind|practice` narrows to one family (the Build sheet is scoped to
 * the noun the user came in on — a run shows run-family routines only). An unrecognized or absent
 * value is no filter, not an error.
 */
const router = Router();
router.use(requireCadenceUser);

router.get('/routines', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const routines = await listRoutines(userId, parseAreaParam(req.query.area));
    res.json({ routines });
  } catch (err) {
    console.error('[GET /plan/routines]', err);
    res.status(500).json({ error: 'failed to load routines' });
  }
});

/**
 * GET /plan/routines/:commitmentId/session — the full latest cached session for ONE lineage (the
 * list route's `steps` are names only; the shelf's player needs the whole prescription). Always
 * 200 with `{ session: OccurrenceSession | null }`: null covers both "never cached" and "not this
 * user's commitment" — `getRoutineSession` already scopes by `user_id`, so there's no separate
 * ownership check and nothing distinguishable to leak between the two.
 */
router.get('/routines/:commitmentId/session', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const session = await getRoutineSession(userId, req.params.commitmentId as string);
    res.json({ session });
  } catch (err) {
    console.error('[GET /plan/routines/:commitmentId/session]', err);
    res.status(500).json({ error: 'failed to load session' });
  }
});

export default router;
