import { Router, type Request, type Response } from 'express';
import { requireCadenceUser } from '../auth/middleware.ts';
import { listRoutines, parseAreaParam } from '../services/routines.ts';

/**
 * GET /plan/routines — the user's coach-built routines: user-kind plan activities grouped by
 * `commitment_id` LINEAGE across every plan version, the read side of Activity Builder A3 ("the
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

export default router;
