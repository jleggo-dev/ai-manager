/**
 * Routes – Health Checks CRUD, manual run, runs, incidents, failure patterns
 */

import { Router, Request, Response } from 'express';
import { validateBody } from '../../middleware/validate.ts';
import { stripSecrets } from '../../lib/sanitize.ts';
import {
  createHealthCheck,
  updateHealthCheck,
  listHealthChecks,
  getHealthCheck,
  deleteHealthCheck,
  updateHcProfile,
  deleteHcProfile,
  listRuns,
  countRuns,
  listIncidents,
  getOpenIncident,
  getFailurePatterns,
  serviceGetHealthCheck,
} from '../../models/health-checks.ts';
import { runAndRecordCheck } from '../../services/health-checker.ts';
import { computeHealthStatus } from '../../lib/health-status.ts';
import type { HealthCheckProfileRow, HealthCheckProviderKeyRow } from '../../types.ts';
import {
  createCheckSchema,
  updateCheckSchema,
  runQuerySchema,
  validateUuidParam,
  mapWithConcurrency,
  logHealthCheckError,
} from './shared.ts';

const router = Router();

router.get('/', async (_req: Request, res: Response) => {
  try {
    const checks = await listHealthChecks();

    const enriched = await mapWithConcurrency(checks, 10, async (check) => {
      try {
        const [runs, incident] = await Promise.all([listRuns(check.id, { limit: 2 }), getOpenIncident(check.id)]);
        const healthStatus = computeHealthStatus(runs[0] ?? null, runs[1] ?? null, incident);
        return { ...(stripSecrets(check) as Record<string, unknown>), healthStatus };
      } catch {
        return { ...(stripSecrets(check) as Record<string, unknown>), healthStatus: 'unknown' as const };
      }
    });

    res.json({ data: enriched });
  } catch (err: unknown) {
    logHealthCheckError(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/', validateBody(createCheckSchema), async (req: Request, res: Response) => {
  try {
    const row = await createHealthCheck(req.body);
    res.status(201).json(row);

    if (row.is_active !== false) {
      serviceGetHealthCheck(row.id)
        .then((full) => runAndRecordCheck(full))
        .catch((err: unknown) => console.error('[hc] Auto-run after create failed:', err));
    }
  } catch (err: unknown) {
    logHealthCheckError(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', validateBody(updateCheckSchema), async (req: Request, res: Response) => {
  try {
    const row = await updateHealthCheck(req.params.id as string, req.body);

    const profileId = row.health_check_profile_id;
    if (profileId) {
      const syncFields: Record<string, unknown> = {};
      if (req.body.name) syncFields.name = req.body.name;
      if (req.body.is_active !== undefined) syncFields.is_active = req.body.is_active;

      if (Object.keys(syncFields).length > 0) {
        await updateHcProfile(profileId, syncFields).catch((err: unknown) => {
          console.warn('[PUT /:id] Syncing linked profile failed:', err);
        });
      }
    }

    res.json(row);
  } catch (err: unknown) {
    logHealthCheckError(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const check = await getHealthCheck(req.params.id as string);
    const profileId = check.health_check_profile_id;

    await deleteHealthCheck(req.params.id as string);

    if (req.query.deleteProfile === 'true' && profileId) {
      await deleteHcProfile(profileId).catch((err: unknown) => {
        console.warn('[DELETE /:id] Cascade profile delete failed:', err);
      });
    }

    res.json({ success: true });
  } catch (err: unknown) {
    logHealthCheckError(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/:id/run', async (req: Request, res: Response) => {
  try {
    await getHealthCheck(req.params.id as string);

    const fullCheck = await serviceGetHealthCheck(req.params.id as string);
    const profile = fullCheck.health_check_profile as
      (HealthCheckProfileRow & { hc_provider_key?: HealthCheckProviderKeyRow }) | undefined;
    if (!profile) {
      return res.status(400).json({ error: 'Health check profile not found' });
    }

    const run = await runAndRecordCheck(fullCheck);
    res.json(run);
  } catch (err: unknown) {
    logHealthCheckError(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id/failure-patterns', async (req: Request, res: Response) => {
  try {
    const id = validateUuidParam(req, res);
    if (!id) return;
    const from =
      typeof req.query.from === 'string'
        ? req.query.from
        : new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const to = typeof req.query.to === 'string' ? req.query.to : new Date().toISOString().slice(0, 10);
    const patterns = await getFailurePatterns(id, from, to);
    res.json(patterns);
  } catch (err: unknown) {
    logHealthCheckError(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id/runs', async (req: Request, res: Response) => {
  try {
    const id = validateUuidParam(req, res);
    if (!id) return;
    const parsed = runQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid query parameters' });
      return;
    }
    const { limit, offset, status, from, to } = parsed.data;

    const filterOpts = { status, from, to };
    const [runs, total] = await Promise.all([
      listRuns(id, { limit, offset, ...filterOpts }),
      countRuns(id, filterOpts),
    ]);
    res.json({ data: runs, total });
  } catch (err: unknown) {
    logHealthCheckError(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id/incidents', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const incidents = await listIncidents(req.params.id as string, { limit });
    res.json({ data: incidents });
  } catch (err: unknown) {
    logHealthCheckError(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
