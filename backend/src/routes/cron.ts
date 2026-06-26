/**
 * Cron Route – Vercel Cron Jobs
 * -----------------------------
 * Two separate cron endpoints to stay within Vercel execution time limits:
 *   /tick/health  — API health checks (fast, no browser needed)
 *   /tick/widget  — Widget checks via Puppeteer (30-50s each, batched)
 *
 * Protected by CRON_SECRET — Vercel attaches this as a Bearer token
 * on cron invocations. Rejects all other callers with 401.
 */

import { Router, Request, Response } from 'express';
import { listDueChecks } from '../models/health-checks.ts';
import { runAndRecordCheck } from '../services/health-checker.ts';
import { listDueWidgetChecks } from '../models/widget-health-checks.ts';
import { runAndRecordWidgetCheck } from '../services/widget-health-checker.ts';

const router = Router();

function verifyCronSecret(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers['authorization'];
  return auth === `Bearer ${secret}`;
}

router.get('/tick/health', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const results = { healthChecks: 0, errors: 0 };

  try {
    const dueChecks = await listDueChecks();
    results.healthChecks = dueChecks.length;

    if (dueChecks.length > 0) {
      const settled = await Promise.allSettled(dueChecks.map((check) => runAndRecordCheck(check)));
      results.errors = settled.filter((r) => r.status === 'rejected').length;
    }
  } catch (err: unknown) {
    console.error('[cron] health-check tick error:', err);
    results.errors++;
  }

  console.log(`[cron] health tick: ${results.healthChecks} checks, ${results.errors} errors`);
  res.json({ ok: true, ...results });
});

router.get('/tick/widget', async (req: Request, res: Response) => {
  if (!verifyCronSecret(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const results = { widgetChecks: 0, errors: 0 };

  try {
    const dueWidgets = await listDueWidgetChecks();
    results.widgetChecks = dueWidgets.length;

    if (dueWidgets.length > 0) {
      const settled = await Promise.allSettled(dueWidgets.map((check) => runAndRecordWidgetCheck(check)));
      results.errors = settled.filter((r) => r.status === 'rejected').length;
    }
  } catch (err: unknown) {
    console.error('[cron] widget-check tick error:', err);
    results.errors++;
  }

  console.log(`[cron] widget tick: ${results.widgetChecks} checks, ${results.errors} errors`);
  res.json({ ok: true, ...results });
});

export default router;
