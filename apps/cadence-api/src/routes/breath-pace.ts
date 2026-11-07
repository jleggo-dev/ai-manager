import { Router, type Request, type Response } from 'express';
import { requireCadenceUser } from '../auth/middleware.ts';
import { getBreathPace, setBreathPace } from '../repos/breath-pace.ts';
import { BodyValidationError, parseBody } from '../validation/body.ts';
import { breathPaceBodySchema } from '../validation/breath-pace.ts';

/**
 * How long a breath count lasts for this person, kept on the account so a new phone doesn't ask
 * them to tune it again. The pacer is the only caller: it paints from the phone's cached value and
 * treats this route as the record, so a failure here costs a sync and never a session.
 */
const router = Router();
router.use(requireCadenceUser);

/** GET /me/breath-pace — always 200 for a signed-in user; `pace` is null until they have set one. */
router.get('/breath-pace', async (req: Request, res: Response) => {
  try {
    res.json({ pace: await getBreathPace(req.cadenceUserId!) });
  } catch (err) {
    console.error('[GET /me/breath-pace]', err);
    res.status(500).json({ error: 'failed to read breath pace' });
  }
});

/** PUT /me/breath-pace — replace it. Returns what was stored. */
router.put('/breath-pace', async (req: Request, res: Response) => {
  try {
    const { pace } = parseBody(breathPaceBodySchema, req.body);
    await setBreathPace(req.cadenceUserId!, pace);
    res.json({ pace });
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[PUT /me/breath-pace]', err);
    res.status(500).json({ error: 'failed to save breath pace' });
  }
});

export default router;
