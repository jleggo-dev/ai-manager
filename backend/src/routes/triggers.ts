/**
 * Routes – Triggers
 * -----------------
 * External-clock trigger endpoint (cron, GitHub Action, etc.) and CRUD.
 */

import { Router, Request, Response } from 'express';
import { getTriggerBySlug, listTriggers, createTrigger, updateTrigger, deleteTrigger } from '../models/triggers.ts';
import { runTrigger } from '../services/trigger-runner.ts';
import { validateBody } from '../middleware/validate.ts';
import { z } from 'zod';
import { errorMessage } from '../lib/error-message.ts';
import { safeClientError } from '../lib/safe-error.ts';

const router = Router();

const createTriggerSchema = z.object({
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  name: z.string().min(1).max(255),
  description: z.string().max(2000).optional(),
  trigger_type: z.enum(['external_clock', 'session.message.created', 'workflow.step.completed']).optional(),
  target_type: z.enum(['job', 'workflow']),
  target_slug: z.string().min(1).max(255),
  config: z.record(z.string(), z.unknown()).optional(),
  is_active: z.boolean().optional(),
});

const runTriggerSchema = z.object({
  variables: z.record(z.string(), z.unknown()).optional(),
  callingApplication: z.string().max(200).optional(),
  userId: z.string().max(200).optional(),
});

function verifyCronOrApiKey(req: Request): boolean {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers['authorization'];
    if (auth === `Bearer ${cronSecret}`) return true;
  }
  /* API key auth handled by authMiddleware for non-cron callers */
  return !!req.headers['authorization'];
}

/** POST /api/triggers/:slug/run — execute trigger (external clock or manual) */
router.post('/:slug/run', validateBody(runTriggerSchema), async (req: Request, res: Response) => {
  try {
    if (!verifyCronOrApiKey(req)) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const trigger = await getTriggerBySlug(req.params.slug as string);
    if (!trigger) return res.status(404).json({ error: 'Trigger not found' });
    if (!trigger.is_active) return res.status(409).json({ error: 'Trigger is inactive' });

    const result = await runTrigger(trigger, req.body);
    const status = result.status === 'success' ? 200 : 500;
    return res.status(status).json(result);
  } catch (err) {
    console.error('[POST /triggers/:slug/run]', err);
    return res.status(500).json({ error: safeClientError(err, 'Failed to run trigger') });
  }
});

router.get('/', async (_req: Request, res: Response) => {
  try {
    const rows = await listTriggers();
    return res.json({ data: rows });
  } catch (err) {
    console.error('[GET /triggers]', err);
    return res.status(500).json({ error: 'Failed to list triggers' });
  }
});

router.post('/', validateBody(createTriggerSchema), async (req: Request, res: Response) => {
  try {
    const row = await createTrigger(req.body);
    return res.status(201).json(row);
  } catch (err) {
    console.error('[POST /triggers]', err);
    if (errorMessage(err).includes('uq_triggers_workspace_slug')) {
      return res.status(409).json({ error: 'A trigger with this slug already exists' });
    }
    return res.status(500).json({ error: safeClientError(err, 'Failed to create trigger') });
  }
});

router.put('/:id', validateBody(createTriggerSchema.partial()), async (req: Request, res: Response) => {
  try {
    const row = await updateTrigger(req.params.id as string, req.body);
    return res.json(row);
  } catch (err) {
    console.error('[PUT /triggers/:id]', err);
    return res.status(500).json({ error: safeClientError(err, 'Failed to update trigger') });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await deleteTrigger(req.params.id as string);
    return res.json({ success: true });
  } catch (err) {
    console.error('[DELETE /triggers/:id]', err);
    return res.status(500).json({ error: 'Failed to delete trigger' });
  }
});

export default router;
