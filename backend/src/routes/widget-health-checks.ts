/**
 * Routes – Widget Health Checks
 * ------------------------------
 * Admin-only endpoints for widget-based health checks.
 * Completely separate from the API health check routes.
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { validateBody } from '../middleware/validate.ts';
import { requireRole } from '../middleware/require-role.ts';
import { stripSecrets } from '../lib/sanitize.ts';
import { getServiceSupabase } from '../db/service-supabase.ts';
import {
  createWidgetCheck,
  updateWidgetCheck,
  listWidgetChecks,
  getWidgetCheck,
  deleteWidgetCheck,
  getWidgetRun,
  listWidgetRuns,
  listWidgetIncidents,
  getOpenWidgetIncident,
  getWidgetDailyRunSummary,
  countWidgetRuns,
  getWidgetFailurePatterns,
} from '../models/widget-health-checks.ts';
import { runAndRecordWidgetCheck, isPuppeteerAvailable } from '../services/widget-health-checker.ts';
import { computeHealthStatus } from '../lib/health-status.ts';

const router = Router();
router.use(requireRole('owner', 'admin'));

/* ── Schemas ──────────────────────────────────────────────── */

const CSS_SELECTOR_MAX = 500;

const createWidgetCheckSchema = z.object({
  name: z.string().min(1).max(200),
  url: z.string().url().max(2000),
  test_message: z.string().min(1).max(2000).optional(),
  cadence_minutes: z.number().int().min(1).max(1440).optional(),
  outage_cadence_minutes: z.number().int().min(1).max(1440).optional(),
  is_active: z.boolean().optional(),
  max_retries: z.number().int().min(1).max(3).optional(),
  shadow_host_selector: z.string().max(CSS_SELECTOR_MAX).optional(),
  launcher_selector: z.string().max(CSS_SELECTOR_MAX).optional(),
  iframe_selector: z.string().max(CSS_SELECTOR_MAX).optional(),
  input_selector: z.string().max(CSS_SELECTOR_MAX).optional(),
  send_selector: z.string().max(CSS_SELECTOR_MAX).optional(),
  response_selector: z.string().max(CSS_SELECTOR_MAX).optional(),
  error_patterns: z.array(z.string().max(200)).max(20).optional(),
  page_load_timeout_ms: z.number().int().min(5000).max(600000).nullable().optional(),
  widget_load_timeout_ms: z.number().int().min(5000).max(600000).nullable().optional(),
  response_timeout_ms: z.number().int().min(10000).max(600000).nullable().optional(),
  capture_screenshot: z.boolean().optional(),
});

const updateWidgetCheckSchema = createWidgetCheckSchema.partial();

const VALID_STATUSES = new Set(['pass', 'fail', 'timeout', 'error', 'warning']);

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

/* ── Helpers ──────────────────────────────────────────────── */

function stripScreenshot(run: Record<string, unknown>): Record<string, unknown> {
  const { screenshot_path: _sp, ...rest } = run;
  return { ...rest, has_screenshot: !!_sp };
}

function sanitizeRunForList(run: unknown): unknown {
  return stripScreenshot(stripSecrets(run) as Record<string, unknown>);
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

/* ── Widget Checks CRUD ──────────────────────────────────── */

router.post('/', validateBody(createWidgetCheckSchema), async (req: Request, res: Response) => {
  try {
    const check = await createWidgetCheck(req.body);
    res.status(201).json(check);

    if (isPuppeteerAvailable()) {
      runAndRecordWidgetCheck(check).catch((err: unknown) =>
        console.error('[widget-hc] Auto-run after create failed:', err),
      );
    }
  } catch (err: unknown) {
    console.error('[widget-health-checks]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/', async (_req: Request, res: Response) => {
  try {
    const checks = await listWidgetChecks();

    const enriched = await mapWithConcurrency(checks, 10, async (check) => {
      try {
        const [runs, incident] = await Promise.all([
          listWidgetRuns(check.id, { limit: 2 }),
          getOpenWidgetIncident(check.id),
        ]);
        const healthStatus = computeHealthStatus(runs[0] ?? null, runs[1] ?? null, incident);
        return { ...check, healthStatus };
      } catch {
        return { ...check, healthStatus: 'unknown' as const };
      }
    });

    res.json({ data: enriched });
  } catch (err: unknown) {
    console.error('[widget-health-checks]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/* ── Dashboard (must precede /:id) ───────────────────────── */

router.get('/dashboard', async (_req: Request, res: Response) => {
  try {
    const checks = await listWidgetChecks();

    const items = await Promise.all(
      checks.map(async (check) => {
        const [runs, incident] = await Promise.all([
          listWidgetRuns(check.id, { limit: 5 }),
          getOpenWidgetIncident(check.id),
        ]);

        const lastRun = runs[0] || null;
        const previousRun = runs[1] || null;

        type Semaphore = 'green' | 'yellow' | 'red' | 'gray';
        const isPass = (s: string) => s === 'pass' || s === 'warning';
        let semaphore: Semaphore;
        if (!lastRun) {
          semaphore = 'gray';
        } else if (!isPass(lastRun.status) || incident) {
          semaphore = 'red';
        } else if (lastRun.status === 'warning') {
          semaphore = 'yellow';
        } else if (previousRun && !isPass(previousRun.status)) {
          semaphore = 'yellow';
        } else {
          semaphore = 'green';
        }

        return {
          id: check.id,
          name: check.name,
          url: check.url,
          cadenceMinutes: check.cadence_minutes,
          outageCadenceMinutes: check.outage_cadence_minutes,
          isActive: check.is_active,
          lastRunAt: check.last_run_at,
          semaphore,
          lastRun: lastRun ? sanitizeRunForList(lastRun) : null,
          recentRuns: runs.map((r) => sanitizeRunForList(r)),
          activeIncident: incident,
        };
      }),
    );

    res.json({ data: items });
  } catch (err: unknown) {
    console.error('[widget-health-checks]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/* ── Uptime History (must precede /:id) ──────────────────── */

router.get('/uptime-history', async (req: Request, res: Response) => {
  try {
    const days = Math.min(Math.max(Number(req.query.days) || 365, 1), 365);
    const endDate = new Date().toISOString().slice(0, 10);
    const startDate = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

    const checks = await listWidgetChecks();

    const data = await Promise.all(
      checks.map(async (check) => {
        const dailyStats = await getWidgetDailyRunSummary(check.id, startDate, endDate);

        const totals = dailyStats.reduce(
          (acc, d) => {
            acc.pass += Number(d.pass_count);
            acc.fail += Number(d.fail_count);
            acc.timeout += Number(d.timeout_count);
            acc.error += Number(d.error_count);
            acc.warning += Number(d.warning_count ?? 0);
            return acc;
          },
          { pass: 0, fail: 0, timeout: 0, error: 0, warning: 0 },
        );

        const totalRuns = totals.pass + totals.warning + totals.fail + totals.timeout + totals.error;
        const uptimePercent =
          totalRuns > 0 ? Math.round(((totals.pass + totals.warning) / totalRuns) * 10_000) / 100 : null;

        return {
          checkId: check.id,
          checkName: check.name,
          checkType: 'widget' as const,
          uptimePercent,
          totals,
          dailyStats: dailyStats.map((d) => ({
            date: d.run_date,
            totalRuns: Number(d.total_runs),
            passCount: Number(d.pass_count),
            failCount: Number(d.fail_count),
            timeoutCount: Number(d.timeout_count),
            errorCount: Number(d.error_count),
            warningCount: Number(d.warning_count ?? 0),
          })),
        };
      }),
    );

    res.json({ data });
  } catch (err: unknown) {
    console.error('[widget-health-checks]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/* ── Failure Patterns (must precede /:id) ────────────────── */

router.get('/:id/failure-patterns', async (req: Request, res: Response) => {
  try {
    const id = validateUuidParam(req, res);
    if (!id) return;
    const from =
      typeof req.query.from === 'string'
        ? req.query.from
        : new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    const to = typeof req.query.to === 'string' ? req.query.to : new Date().toISOString().slice(0, 10);
    const patterns = await getWidgetFailurePatterns(id, from, to);
    res.json(patterns);
  } catch (err: unknown) {
    console.error('[widget-health-checks]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/* ── Single Check ────────────────────────────────────────── */

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const check = await getWidgetCheck(req.params.id as string);
    res.json(check);
  } catch (err: unknown) {
    console.error('[widget-health-checks]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/:id', validateBody(updateWidgetCheckSchema), async (req: Request, res: Response) => {
  try {
    const row = await updateWidgetCheck(req.params.id as string, req.body);
    res.json(row);
  } catch (err: unknown) {
    console.error('[widget-health-checks]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    await deleteWidgetCheck(req.params.id as string);
    res.status(204).send();
  } catch (err: unknown) {
    console.error('[widget-health-checks]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/* ── Manual Run ──────────────────────────────────────────── */

router.post('/:id/run', async (req: Request, res: Response) => {
  try {
    if (!isPuppeteerAvailable()) {
      return res.status(503).json({ error: 'Puppeteer is not available in this environment' });
    }
    const check = await getWidgetCheck(req.params.id as string);
    const run = await runAndRecordWidgetCheck(check);
    res.json(stripSecrets(run));
  } catch (err: unknown) {
    console.error('[widget-health-checks]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/* ── Run History & Incidents ─────────────────────────────── */

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
      listWidgetRuns(id, { limit, offset, ...filterOpts }),
      countWidgetRuns(id, filterOpts),
    ]);
    res.json({ data: runs.map(sanitizeRunForList), total });
  } catch (err: unknown) {
    console.error('[widget-health-checks]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/runs/:runId/screenshot', async (req: Request, res: Response) => {
  try {
    const run = await getWidgetRun(req.params.runId as string);

    if (!run.screenshot_path) {
      return res.status(404).json({ error: 'No screenshot available for this run' });
    }

    const sb = getServiceSupabase();
    const { data, error } = await sb.storage.from('widget-hc-screenshots').createSignedUrl(run.screenshot_path, 300);
    if (error || !data?.signedUrl) {
      return res.status(500).json({ error: 'Failed to generate signed URL' });
    }
    return res.json({ url: data.signedUrl });
  } catch (err: unknown) {
    console.error('[widget-health-checks]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/:id/incidents', async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 20, 100);
    const incidents = await listWidgetIncidents(req.params.id as string, { limit });
    res.json({ data: incidents });
  } catch (err: unknown) {
    console.error('[widget-health-checks]', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
