import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireCadenceUser } from '../auth/middleware.ts';
import { BodyValidationError, parseBody } from '../validation/body.ts';
import { HOW_TO_SENTENCE_MAX, keepHowTo } from '../services/activity-how-to.ts';

/**
 * POST /plan/activity-how-to — the Recap's "Every time" (services/activity-how-to.ts). Its own
 * file: one write, and plan.ts is at the size gate.
 *   200 { status: 'written' | 'present', how_to, activity } — the instruction as it now reads
 *   422 { error: 'how_to_full', how_to, activity }          — at its bound; nothing written
 *   404 { error: 'occurrence not found' }                   — not this user's session
 *   400                                                     — no sentence, or not a short one
 */
const router = Router();
router.use(requireCadenceUser);

const bodySchema = z.object({
  occurrence_id: z.string().trim().min(1, 'occurrence_id is required'),
  sentence: z.string().trim().min(1, 'sentence is required').max(HOW_TO_SENTENCE_MAX),
});

router.post('/activity-how-to', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const body = parseBody(bodySchema, req.body);
    const r = await keepHowTo(userId, body.occurrence_id, body.sentence);
    if (r.status === 'not_found') return void res.status(404).json({ error: 'occurrence not found' });
    if (r.status === 'full') return void res.status(422).json({ error: 'how_to_full', how_to: r.how_to, activity: r.activity });
    res.json(r);
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[POST /plan/activity-how-to]', err);
    res.status(500).json({ error: 'failed to keep the instruction' });
  }
});

export default router;
