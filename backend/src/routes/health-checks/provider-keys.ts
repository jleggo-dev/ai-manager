/**
 * Routes – Health Check Provider Keys
 */

import { Router, Request, Response } from 'express';
import { validateBody } from '../../middleware/validate.ts';
import { stripSecrets } from '../../lib/sanitize.ts';
import {
  createProviderKey,
  updateProviderKey,
  listProviderKeys,
  deleteProviderKey,
} from '../../models/health-checks.ts';
import { createProviderKeySchema, updateProviderKeySchema, logHealthCheckError } from './shared.ts';

const router = Router();

router.get('/provider-keys', async (_req: Request, res: Response) => {
  try {
    const keys = await listProviderKeys();
    res.json({ data: keys.map((k) => stripSecrets(k)) });
  } catch (err: unknown) {
    logHealthCheckError(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/provider-keys', validateBody(createProviderKeySchema), async (req: Request, res: Response) => {
  try {
    const row = await createProviderKey(req.body);
    res.status(201).json(stripSecrets(row));
  } catch (err: unknown) {
    logHealthCheckError(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/provider-keys/:id', validateBody(updateProviderKeySchema), async (req: Request, res: Response) => {
  try {
    const row = await updateProviderKey(req.params.id as string, req.body);
    res.json(stripSecrets(row));
  } catch (err: unknown) {
    logHealthCheckError(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/provider-keys/:id', async (req: Request, res: Response) => {
  try {
    await deleteProviderKey(req.params.id as string);
    res.json({ success: true });
  } catch (err: unknown) {
    logHealthCheckError(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
