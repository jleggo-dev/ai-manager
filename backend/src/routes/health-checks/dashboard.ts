/**
 * Routes – Health Check Dashboard + Uptime History
 */

import { Router, Request, Response } from 'express';
import { listHealthChecks, listRuns, getOpenIncident, getDailyRunSummary } from '../../models/health-checks.ts';
import { logHealthCheckError } from './shared.ts';

const router = Router();

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
    logHealthCheckError(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

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
    logHealthCheckError(err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
