import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { ITEM_LOAD_MAX, ITEM_NAME_MAX } from '@cadence/shared';
import { requireCadenceUser } from '../auth/middleware.ts';
import { BodyValidationError, parseBody } from '../validation/body.ts';
import { askAlternativeItem } from '../services/alternative-item.ts';

/**
 * POST /plan/alternative-item — the Change sheet's "Something else" (services/alternative-item.ts).
 * Its own file: one job, one answer, and plan.ts is at the size gate.
 *   200 { alternative }        — one move in the SessionItemAlternative shape
 *   503 { error: 'coach_unreachable' } — no usable answer inside the budget; the sheet says so
 *   400                        — no item name
 */
const router = Router();
router.use(requireCadenceUser);

const positive = z.number().positive().optional();
const bodySchema = z.object({
  activity: z.string().trim().max(200).optional(),
  item: z.object({
    name: z.string().trim().min(1, 'item name is required').max(ITEM_NAME_MAX),
    sets: positive,
    reps: positive,
    load: z.string().trim().max(ITEM_LOAD_MAX).optional(),
    duration_min: positive,
    distance_km: positive,
    detail: z.string().trim().max(600).optional(),
  }),
  already_offered: z.array(z.string().trim().max(ITEM_NAME_MAX)).max(12).optional(),
});

router.post('/alternative-item', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const body = parseBody(bodySchema, req.body);
    const r = await askAlternativeItem(userId, {
      activity: body.activity || undefined,
      item: body.item,
      alreadyOffered: body.already_offered,
    });
    if (r.status === 'ok') return void res.json({ alternative: r.alternative });
    res.status(503).json({ error: 'coach_unreachable' });
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[POST /plan/alternative-item]', err);
    res.status(500).json({ error: 'failed to ask for an alternative' });
  }
});

export default router;
