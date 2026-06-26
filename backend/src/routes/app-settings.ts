import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { listSettings, getSetting, upsertSetting, deleteSetting } from '../models/app-settings.ts';
import { validateBody } from '../middleware/validate.ts';

const updateSettingSchema = z.object({
  value: z.unknown().refine((v) => v !== undefined, { message: 'value is required' }),
  description: z.string().max(2000).optional(),
});

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  try {
    const settings = await listSettings();
    return res.json(settings);
  } catch (err) {
    console.error('[GET /settings]', err);
    return res.status(500).json({ error: 'Failed to list settings' });
  }
});

router.get('/:key', async (req: Request, res: Response) => {
  try {
    const setting = await getSetting(req.params.key as string);
    if (!setting) return res.status(404).json({ error: 'Setting not found' });
    return res.json(setting);
  } catch (err) {
    console.error('[GET /settings/:key]', err);
    return res.status(500).json({ error: 'Failed to retrieve setting' });
  }
});

router.put('/:key', validateBody(updateSettingSchema), async (req: Request, res: Response) => {
  try {
    const { value, description } = req.body;
    const updated = await upsertSetting(req.params.key as string, value, description);
    return res.json(updated);
  } catch (err) {
    console.error('[PUT /settings/:key]', err);
    return res.status(500).json({ error: 'Failed to update setting' });
  }
});

router.delete('/:key', async (req: Request, res: Response) => {
  try {
    await deleteSetting(req.params.key as string);
    return res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /settings/:key]', err);
    return res.status(500).json({ error: 'Failed to delete setting' });
  }
});

export default router;
