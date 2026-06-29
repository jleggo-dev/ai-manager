/**
 * Routes – Config sync (config-as-code)
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { validateBody } from '../middleware/validate.ts';
import { syncConfig } from '../services/config-sync.ts';
import { safeClientError } from '../lib/safe-error.ts';

const router = Router();

const syncSchema = z.object({
  dryRun: z.boolean().optional(),
  profiles: z.array(z.record(z.string(), z.unknown())).optional(),
  jobs: z.array(z.record(z.string(), z.unknown())).optional(),
  workflows: z.array(z.record(z.string(), z.unknown())).optional(),
});

router.post('/', validateBody(syncSchema), async (req: Request, res: Response) => {
  try {
    const { dryRun, ...config } = req.body;
    const result = await syncConfig(config, dryRun === true);
    const status = result.errors > 0 ? 422 : 200;
    return res.status(status).json(result);
  } catch (err) {
    console.error('[POST /sync]', err);
    return res.status(500).json({ error: safeClientError(err, 'Sync failed') });
  }
});

export default router;
