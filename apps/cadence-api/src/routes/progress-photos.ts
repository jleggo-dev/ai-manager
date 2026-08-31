/**
 * Progress photos (owner design "Cadence Progress" 1a) — a third router mounted at '/progress',
 * the same pattern '/plan' uses for four. Opt-in end to end: everything here answers "off" (or
 * 403 for a write) until the user turns the feature on, and the enable switch itself is the only
 * route that works either way. Photos are dated and weight-stamped, never scored — no route here
 * computes a comparison.
 */
import { Router, type Request, type Response } from 'express';
import { requireCadenceUser } from '../auth/middleware.ts';
import { setProgressPhotosEnabled, getUser } from '../repos/users.ts';
import { getPhotoPair, listProgressPhotoCards, putProgressPhoto } from '../services/progress-photos.ts';
import {
  BodyValidationError,
  parseBody,
  progressPhotoBodySchema,
  progressPhotosEnabledBodySchema,
} from '../validation/body.ts';

const router = Router();
router.use(requireCadenceUser);

/** GET /progress/photos — the full list (signed URLs, oldest first) + count + next-due + the
 *  opt-in state. Off — the default — returns the honest empty shape, never an error. */
router.get('/photos', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    res.json(await listProgressPhotoCards(userId));
  } catch (err) {
    console.error('[GET /progress/photos]', err);
    res.status(500).json({ error: 'failed to load progress photos' });
  }
});

/** GET /progress/photo-pair — `photo_pair`: earliest + latest for the card, or `{ omission }`
 *  with the evidence (off, or none added yet). */
router.get('/photo-pair', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const result = await getPhotoPair(userId);
    res.json('reason' in result ? { omission: result } : result);
  } catch (err) {
    console.error('[GET /progress/photo-pair]', err);
    res.status(500).json({ error: 'failed to load photo pair' });
  }
});

/** POST /progress/photos — store one photo (data-URL; `taken_on` defaults to today). 403 while
 *  the feature is off: a photo the user never opted into keeping must not be kept. */
router.post('/photos', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const body = parseBody(progressPhotoBodySchema, req.body);
    const stored = await putProgressPhoto(userId, body.photo, body.taken_on);
    if (!stored) return void res.status(403).json({ error: 'progress photos are off — turn them on first' });
    res.json({
      photo: { date: stored.row.taken_on, weight_kg: stored.row.weight_kg },
      next_due: stored.next_due,
    });
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    const msg = err instanceof Error ? err.message : '';
    if (/invalid photo/.test(msg)) return void res.status(400).json({ error: msg });
    console.error('[POST /progress/photos]', err);
    res.status(500).json({ error: 'failed to store the photo' });
  }
});

/** PUT /progress/photos/enabled — the opt-in switch. Returns what the server actually stored. */
router.put('/photos/enabled', async (req: Request, res: Response) => {
  const userId = req.cadenceUserId!;
  try {
    const { enabled } = parseBody(progressPhotosEnabledBodySchema, req.body);
    await setProgressPhotosEnabled(userId, enabled);
    const user = await getUser(userId);
    res.json({ enabled: user?.progress_photos_enabled === true });
  } catch (err) {
    if (err instanceof BodyValidationError) return void res.status(400).json({ error: err.message });
    console.error('[PUT /progress/photos/enabled]', err);
    res.status(500).json({ error: 'failed to save the photo setting' });
  }
});

export default router;
