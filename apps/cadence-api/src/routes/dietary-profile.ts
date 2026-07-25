import { Router, type Request, type Response } from 'express';
import { EMPTY_DIETARY_PROFILE, sanitizeDietaryProfile } from '@cadence/shared';
import { requireCadenceUser } from '../auth/middleware.ts';
import { getDietaryProfile, setDietaryProfile } from '../repos/users.ts';
import { BodyValidationError, parseBody } from '../validation/body.ts';
import { dietaryProfileBodySchema } from '../validation/dietary.ts';

const router = Router();
router.use(requireCadenceUser);

/**
 * GET /nutrition/dietary-profile — allergies / diet / dislikes for Settings + safety pass.
 * Always 200 with a profile (empty defaults when unset).
 */
router.get('/dietary-profile', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const raw = await getDietaryProfile(userId);
    const profile = sanitizeDietaryProfile(raw) ?? { ...EMPTY_DIETARY_PROFILE };
    res.json({ dietary_profile: profile });
  } catch (err) {
    console.error('[GET /nutrition/dietary-profile]', err);
    res.status(500).json({ error: 'failed to load dietary profile' });
  }
});

/**
 * POST /nutrition/dietary-profile — confirm-first save from Settings (whole-object replace).
 */
router.post('/dietary-profile', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const body = parseBody(dietaryProfileBodySchema, req.body);
    const profile = sanitizeDietaryProfile(body) ?? { ...EMPTY_DIETARY_PROFILE };
    await setDietaryProfile(userId, profile);
    res.json({ dietary_profile: profile });
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[POST /nutrition/dietary-profile]', err);
    res.status(500).json({ error: 'failed to save dietary profile' });
  }
});

export default router;
