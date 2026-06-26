/**
 * Routes – Calling Applications
 * --------------------------------
 * CRUD for the lightweight calling-application registry.
 * Most entries are auto-created by the AI Manager on first API call;
 * these routes let admins list, rename, and delete entries.
 */

import { Router, Request, Response } from 'express';
import {
  listCallingApplications,
  getCallingApplication,
  upsertCallingApplication,
  updateCallingApplication,
  deleteCallingApplication,
} from '../models/calling-applications.ts';
import { validateBody } from '../middleware/validate.ts';
import { createCallingApplicationSchema, updateCallingApplicationSchema } from '../schemas/calling-applications.ts';
import { parsePagination, buildPaginatedResponse } from '../lib/pagination.ts';

const router = Router();

/* GET /api/calling-applications */
router.get('/', async (req: Request, res: Response) => {
  try {
    const params = parsePagination(req);
    const rows = await listCallingApplications({ cursor: params.cursor ?? undefined, limit: params.limit });
    return res.json(buildPaginatedResponse(rows, params));
  } catch (err) {
    console.error('[GET /calling-applications]', err);
    return res.status(500).json({ error: 'Failed to list calling applications' });
  }
});

/* GET /api/calling-applications/:id */
router.get('/:id', async (req: Request, res: Response) => {
  try {
    const row = await getCallingApplication(req.params.id as string);
    if (!row) return res.status(404).json({ error: 'Calling application not found' });
    return res.json(row);
  } catch (err) {
    console.error('[GET /calling-applications/:id]', err);
    return res.status(500).json({ error: 'Failed to retrieve calling application' });
  }
});

/* POST /api/calling-applications (manual create / upsert) */
router.post('/', validateBody(createCallingApplicationSchema), async (req: Request, res: Response) => {
  try {
    const { id, display_name } = req.body;
    if (!id) return res.status(400).json({ error: 'id is required' });
    const row = await upsertCallingApplication(id, display_name);
    return res.status(201).json(row);
  } catch (err) {
    console.error('[POST /calling-applications]', err);
    return res.status(500).json({ error: 'Failed to create calling application' });
  }
});

const CA_ALLOWED_FIELDS = new Set(['display_name']);

/* PUT /api/calling-applications/:id (rename) */
router.put('/:id', validateBody(updateCallingApplicationSchema), async (req: Request, res: Response) => {
  try {
    const filtered: Record<string, unknown> = {};
    for (const key of Object.keys(req.body)) {
      if (CA_ALLOWED_FIELDS.has(key)) filtered[key] = req.body[key];
    }
    const row = await updateCallingApplication(req.params.id as string, filtered);
    return res.json(row);
  } catch (err) {
    console.error('[PUT /calling-applications/:id]', err);
    return res.status(500).json({ error: 'Failed to update calling application' });
  }
});

/* DELETE /api/calling-applications/:id */
router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await deleteCallingApplication(req.params.id as string);
    return res.status(204).end();
  } catch (err) {
    console.error('[DELETE /calling-applications/:id]', err);
    return res.status(500).json({ error: 'Failed to delete calling application' });
  }
});

export default router;
