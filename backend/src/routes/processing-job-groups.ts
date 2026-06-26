import { Router, Request, Response } from 'express';
import { z } from 'zod';
import {
  listProcessingJobGroups,
  createProcessingJobGroup,
  updateProcessingJobGroup,
  deleteProcessingJobGroup,
} from '../models/processing-job-groups.ts';
import { listProcessingJobs, updateProcessingJob } from '../models/processing-jobs.ts';
import { validateBody } from '../middleware/validate.ts';

const createGroupSchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  app_id: z.string().max(200).optional(),
  slug: z.string().max(200).optional(),
  sort_order: z.number().int().optional(),
});

const updateGroupSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  slug: z.string().max(200).optional(),
  sort_order: z.number().int().optional(),
});

import { slugify } from '../lib/slugify.ts';

const router = Router();

router.get('/', async (req: Request, res: Response) => {
  try {
    const appId = String(req.query?.appId || '').trim();
    const rows = await listProcessingJobGroups(appId);
    return res.json(rows);
  } catch (err) {
    console.error('[GET /processing-job-groups]', err);
    return res.status(500).json({ error: 'Failed to list processing job groups' });
  }
});

router.post('/', validateBody(createGroupSchema), async (req: Request, res: Response) => {
  try {
    const appId = String(req.body?.app_id || '').trim();
    const name = String(req.body?.name || '').trim();
    const slug = slugify(req.body?.slug || name);
    const sortOrder = Number.isFinite(Number(req.body?.sort_order)) ? Number(req.body.sort_order) : 0;

    if (!appId) return res.status(400).json({ error: 'app_id is required' });
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (!slug) return res.status(400).json({ error: 'slug is required' });

    const row = await createProcessingJobGroup({
      app_id: appId,
      name,
      slug,
      sort_order: sortOrder,
    });
    return res.status(201).json(row);
  } catch (err) {
    console.error('[POST /processing-job-groups]', err);
    return res.status(500).json({ error: 'Failed to create processing job group' });
  }
});

router.put('/:id', validateBody(updateGroupSchema), async (req: Request, res: Response) => {
  try {
    const updates: Record<string, unknown> = {};
    if (req.body?.name != null) {
      const name = String(req.body.name || '').trim();
      if (!name) return res.status(400).json({ error: 'name cannot be empty' });
      updates.name = name;
    }
    if (req.body?.slug != null) {
      const slug = slugify(req.body.slug);
      if (!slug) return res.status(400).json({ error: 'slug cannot be empty' });
      updates.slug = slug;
    }
    if (req.body?.sort_order != null) {
      const sortOrder = Number(req.body.sort_order);
      if (!Number.isFinite(sortOrder)) {
        return res.status(400).json({ error: 'sort_order must be a number' });
      }
      updates.sort_order = sortOrder;
    }

    const row = await updateProcessingJobGroup(req.params.id as string, updates);
    return res.json(row);
  } catch (err) {
    console.error('[PUT /processing-job-groups/:id]', err);
    return res.status(500).json({ error: 'Failed to update processing job group' });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const groupId = req.params.id;
    const jobs = await listProcessingJobs({ limit: 200 });
    const assigned = (jobs || []).filter((job: { id: string; config?: Record<string, unknown> }) => {
      const subgroupId = job?.config?.subgroupId;
      return subgroupId && subgroupId === groupId;
    });

    for (const job of assigned) {
      await updateProcessingJob(job.id, {
        config: { subgroupId: null },
      });
    }

    await deleteProcessingJobGroup(groupId as string);
    return res.status(204).end();
  } catch (err) {
    console.error('[DELETE /processing-job-groups/:id]', err);
    return res.status(500).json({ error: 'Failed to delete processing job group' });
  }
});

export default router;
