/**
 * Routes – Health Checks
 * -----------------------
 * Admin-only endpoints for the Health Checker feature:
 * provider keys, profiles, check configs, manual runs, and dashboard.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { validateBody } from '../middleware/validate.ts';
import { stripSecrets } from '../lib/sanitize.ts';
import { requireRole } from '../middleware/require-role.ts';
import {
  createProviderKey,
  updateProviderKey,
  listProviderKeys,
  deleteProviderKey,
  createHcProfile,
  updateHcProfile,
  listHcProfiles,
  deleteHcProfile,
  createHealthCheck,
  updateHealthCheck,
  listHealthChecks,
  getHealthCheck,
  deleteHealthCheck,
  listRuns,
  countRuns,
  listIncidents,
  getOpenIncident,
  getDailyRunSummary,
  getFailurePatterns,
  serviceGetHealthCheck,
} from '../models/health-checks.ts';
import { runAndRecordCheck } from '../services/health-checker.ts';
import { computeHealthStatus } from '../lib/health-status.ts';
import type { HealthCheckProfileRow, HealthCheckProviderKeyRow } from '../types.ts';

const router = Router();
router.use(requireRole('owner', 'admin'));

/* ── Schemas ──────────────────────────────────────────────── */

const createProviderKeySchema = z.object({
  provider_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  api_key: z.string().min(1),
  is_active: z.boolean().optional(),
});

const updateProviderKeySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  api_key: z.string().min(1).optional(),
  is_active: z.boolean().optional(),
});

const createProfileSchema = z.object({
  provider_id: z.string().uuid(),
  hc_provider_key_id: z.string().uuid(),
  external_ai_id: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  mode: z.enum(['completion', 'chat']).optional(),
  profile_type: z.enum(['agent', 'model']).optional(),
  runtime_options: z.record(z.string(), z.unknown()).optional(),
  is_active: z.boolean().optional(),
});

const updateProfileSchema = z.object({
  external_ai_id: z.string().min(1).max(200).optional(),
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  mode: z.enum(['completion', 'chat']).optional(),
  profile_type: z.enum(['agent', 'model']).optional(),
  runtime_options: z.record(z.string(), z.unknown()).optional(),
  is_active: z.boolean().optional(),
});

const createCheckSchema = z.object({
  health_check_profile_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  test_message: z.string().min(1).max(2000).optional(),
  cadence_minutes: z.number().int().min(1).max(1440).optional(),
  outage_cadence_minutes: z.number().int().min(1).max(1440).optional(),
  is_active: z.boolean().optional(),
});

const updateCheckSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  test_message: z.string().min(1).max(2000).optional(),
  cadence_minutes: z.number().int().min(1).max(1440).optional(),
  outage_cadence_minutes: z.number().int().min(1).max(1440).optional(),
  is_active: z.boolean().optional(),
});

const VALID_STATUSES = new Set(['pass', 'fail', 'timeout', 'error']);

const runQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
  status: z
    .string()
    .optional()
    .transform((v) => {
      if (!v) return undefined;
      return v
        .split(',')
        .filter((s) => VALID_STATUSES.has(s))
        .slice(0, 4);
    }),
  from: z
    .string()
    .datetime({ offset: true })
    .optional()
    .or(
      z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    ),
  to: z
    .string()
    .datetime({ offset: true })
    .optional()
    .or(
      z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .optional(),
    ),
});

const uuidParam = z.string().uuid();

function validateUuidParam(req: Request, res: Response): string | null {
  const result = uuidParam.safeParse(req.params.id);
  if (!result.success) {
    res.status(400).json({ error: 'Invalid ID format' });
    return null;
  }
  return result.data;
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const batch = items.slice(i, i + limit);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

/* ── Provider Keys ────────────────────────────────────────── */

router.get('/provider-keys', async (_req: Request, res: Response) => {
  try {
    const keys = await listProviderKeys();
    res.json({ data: keys.map((k) => stripSecrets(k)) });
  } catch (err: unknown) {
    console.error('[health-checks]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/provider-keys', validateBody(createProviderKeySchema), async (req: Request, res: Response) => {
  try {
    const row = await createProviderKey(req.body);
    res.status(201).json(stripSecrets(row));
  } catch (err: unknown) {
    console.error('[health-checks]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/provider-keys/:id', validateBody(updateProviderKeySchema), async (req: Request, res: Response) => {
  try {
    const row = await updateProviderKey(req.params.id as string, req.body);
    res.json(stripSecrets(row));
  } catch (err: unknown) {
    console.error('[health-checks]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/provider-keys/:id', async (req: Request, res: Response) => {
  try {
    await deleteProviderKey(req.params.id as string);
    res.json({ success: true });
  } catch (err: unknown) {
    console.error('[health-checks]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/* ── Profiles ─────────────────────────────────────────────── */

router.get('/profiles', async (_req: Request, res: Response) => {
  try {
    const profiles = await listHcProfiles();
    res.json({ data: profiles });
  } catch (err: unknown) {
    console.error('[health-checks]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/profiles', validateBody(createProfileSchema), async (req: Request, res: Response) => {
  try {
    const row = await createHcProfile(req.body);

    try {
      await createHealthCheck({
        health_check_profile_id: row.id,
        name: row.name,
        test_message: 'Hello, please confirm you are operational.',
        cadence_minutes: 5,
        outage_cadence_minutes: 2,
        is_active: true,
      } as Record<string, unknown>);
    } catch (checkErr: unknown) {
      console.warn('[POST /profiles] Profile created but auto-check failed:', checkErr);
    }

    res.status(201).json(row);
  } catch (err: unknown) {
    console.error('[health-checks]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/profiles/:id', validateBody(updateProfileSchema), async (req: Request, res: Response) => {
  try {
    const row = await updateHcProfile(req.params.id as string, req.body);

    const syncFields: Record<string, unknown> = {};
    if (req.body.name) syncFields.name = req.body.name;
    if (req.body.is_active !== undefined) syncFields.is_active = req.body.is_active;

    if (Object.keys(syncFields).length > 0) {
      const checks = await listHealthChecks();
      const linked = checks.find((c) => c.health_check_profile_id === req.params.id);
      if (linked) {
        await updateHealthCheck(linked.id, syncFields).catch((err: unknown) => {
          console.warn('[PUT /profiles/:id] Syncing linked check failed:', err);
        });
      }
    }

    res.json(row);
  } catch (err: unknown) {
    console.error('[health-checks]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/profiles/:id', async (req: Request, res: Response) => {
  try {
    await deleteHcProfile(req.params.id as string);
    res.json({ success: true });
  } catch (err: unknown) {
    console.error('[health-checks]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/profiles/backfill-checks', async (_req: Request, res: Response) => {
  try {
    const profiles = await listHcProfiles();
    const checks = await listHealthChecks();
    const profilesWithChecks = new Set(checks.map((c) => c.health_check_profile_id));
    let created = 0;

    for (const profile of profiles) {
      if (profilesWithChecks.has(profile.id)) continue;
      await createHealthCheck({
        health_check_profile_id: profile.id,
        name: profile.name,
        test_message: 'Hello, please confirm you are operational.',
        cadence_minutes: 5,
        outage_cadence_minutes: 2,
        is_active: profile.is_active,
      } as Record<string, unknown>);
      created++;
    }

    res.json({ success: true, created, total_profiles: profiles.length });
  } catch (err: unknown) {
    console.error('[health-checks]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/* ── Health Checks ────────────────────────────────────────── */

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
    console.error('[health-checks]', err);
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
    console.error('[health-checks]', err);
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
    console.error('[health-checks]', err);
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
    console.error('[health-checks]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/* ── Manual Run ───────────────────────────────────────────── */

router.post('/:id/run', async (req: Request, res: Response) => {
  try {
    await getHealthCheck(req.params.id as string);

    const fullCheck = await serviceGetHealthCheck(req.params.id as string);
    const profile = fullCheck.health_check_profile as
      | (HealthCheckProfileRow & { hc_provider_key?: HealthCheckProviderKeyRow })
      | undefined;
    if (!profile) {
      return res.status(400).json({ error: 'Health check profile not found' });
    }

    const run = await runAndRecordCheck(fullCheck);
    res.json(run);
  } catch (err: unknown) {
    console.error('[health-checks]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/* ── Failure Patterns ─────────────────────────────────────── */

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
    console.error('[health-checks]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/* ── Run history and incidents ────────────────────────────── */

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
    console.error('[health-checks]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id/incidents', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const incidents = await listIncidents(req.params.id as string, { limit });
    res.json({ data: incidents });
  } catch (err: unknown) {
    console.error('[health-checks]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/* ── Dashboard ────────────────────────────────────────────── */

router.get('/dashboard', async (_req: Request, res: Response) => {
  try {
    const checks = await listHealthChecks();

    const items = await Promise.all(
      checks.map(async (check) => {
        const [runs, incident] = await Promise.all([listRuns(check.id, { limit: 5 }), getOpenIncident(check.id)]);

        const lastRun = runs[0] || null;
        const previousRun = runs[1] || null;

        type Semaphore = 'green' | 'yellow' | 'red' | 'gray';
        let semaphore: Semaphore;
        if (!lastRun) {
          semaphore = 'gray';
        } else if (lastRun.status !== 'pass' || incident) {
          semaphore = 'red';
        } else if (previousRun && previousRun.status !== 'pass') {
          semaphore = 'yellow';
        } else {
          semaphore = 'green';
        }

        return {
          id: check.id,
          name: check.name,
          profileName: check.health_check_profile?.name || null,
          providerName: check.health_check_profile?.provider?.name || null,
          cadenceMinutes: check.cadence_minutes,
          outageCadenceMinutes: check.outage_cadence_minutes,
          isActive: check.is_active,
          lastRunAt: check.last_run_at,
          semaphore,
          lastRun,
          recentRuns: runs,
          activeIncident: incident,
        };
      }),
    );

    res.json({ data: items });
  } catch (err: unknown) {
    console.error('[health-checks]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/* ── Uptime History ──────────────────────────────────────── */

router.get('/uptime-history', async (req: Request, res: Response) => {
  try {
    const days = Math.min(Math.max(Number(req.query.days) || 365, 1), 365);
    const endDate = new Date().toISOString().slice(0, 10);
    const startDate = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

    const checks = await listHealthChecks();

    const data = await Promise.all(
      checks.map(async (check) => {
        const dailyStats = await getDailyRunSummary(check.id, startDate, endDate);

        const totals = dailyStats.reduce(
          (acc, d) => {
            acc.pass += Number(d.pass_count);
            acc.fail += Number(d.fail_count);
            acc.timeout += Number(d.timeout_count);
            acc.error += Number(d.error_count);
            return acc;
          },
          { pass: 0, fail: 0, timeout: 0, error: 0, warning: 0 },
        );

        const totalRuns = totals.pass + totals.fail + totals.timeout + totals.error;
        const uptimePercent = totalRuns > 0 ? Math.round((totals.pass / totalRuns) * 10_000) / 100 : null;

        return {
          checkId: check.id,
          checkName: check.name,
          checkType: 'api' as const,
          uptimePercent,
          totals,
          dailyStats: dailyStats.map((d) => ({
            date: d.run_date,
            totalRuns: Number(d.total_runs),
            passCount: Number(d.pass_count),
            failCount: Number(d.fail_count),
            timeoutCount: Number(d.timeout_count),
            errorCount: Number(d.error_count),
            warningCount: 0,
          })),
        };
      }),
    );

    res.json({ data });
  } catch (err: unknown) {
    console.error('[health-checks]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
