/**
 * Coach food surface (Req 5) — confirm-first actions prepared from chat.
 * Mounted under /coach so coach.ts stays lean (WS-I coordination).
 */
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireCadenceUser } from '../auth/middleware.ts';
import { prepareCoachFoodAction } from '../services/coach-food-intent.ts';
import { BodyValidationError, parseBody } from '../validation/body.ts';

const router = Router();
router.use(requireCadenceUser);

const foodActionBodySchema = z
  .object({
    message: z.string().trim().min(1).max(2000),
    window: z.string().max(8000).optional(),
  })
  .strict();

/**
 * POST /coach/food-actions — classify + prepare a confirm draft (resolve / from-chat / dietary).
 * Never persists. Client shows a confirm sheet; commit uses existing nutrition routes.
 */
router.post('/food-actions', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const body = parseBody(foodActionBodySchema, req.body);
    const action = await prepareCoachFoodAction(userId, {
      message: body.message,
      window: body.window,
    });
    res.json({ action });
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[POST /coach/food-actions]', err);
    res.status(500).json({ error: 'failed to prepare food action' });
  }
});

export default router;
