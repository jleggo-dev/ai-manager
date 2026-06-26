/**
 * Service – Widget Health Check Scheduler
 * ----------------------------------------
 * A standalone in-process scheduler for widget health checks.
 * Completely separate from the API health check scheduler to
 * avoid any regression risk. Uses the same polling pattern:
 * every 60s, query for due checks and execute them.
 *
 * Start via `startWidgetHealthCheckScheduler()` during server boot.
 * Only starts if the Puppeteer probe succeeds.
 */

import { listDueWidgetChecks } from '../models/widget-health-checks.ts';
import { runAndRecordWidgetCheck, probePuppeteer } from './widget-health-checker.ts';

const POLL_INTERVAL_MS = 60_000;
let intervalHandle: ReturnType<typeof setInterval> | null = null;

async function tick(): Promise<void> {
  try {
    const dueChecks = await listDueWidgetChecks();
    if (dueChecks.length === 0) return;

    console.log(`[widget-scheduler] ${dueChecks.length} widget check(s) due`);

    const settled = await Promise.allSettled(
      dueChecks.map((check) =>
        runAndRecordWidgetCheck(check).catch((err: unknown) => {
          console.error(`[widget-scheduler] check ${check.id} failed:`, err);
        }),
      ),
    );

    const failures = settled.filter((r) => r.status === 'rejected');
    if (failures.length > 0) {
      console.warn(`[widget-scheduler] ${failures.length} check(s) errored out`);
    }
  } catch (err: unknown) {
    console.error('[widget-scheduler] tick error:', err);
  }
}

export async function startWidgetHealthCheckScheduler(): Promise<void> {
  if (intervalHandle) return;

  const available = await probePuppeteer();
  if (!available) {
    console.warn('[widget-scheduler] Puppeteer not available — widget scheduler will NOT start');
    return;
  }

  console.log('[widget-scheduler] Starting (poll every 60s)');
  intervalHandle = setInterval(tick, POLL_INTERVAL_MS);
  setTimeout(tick, 8_000);
}

export function stopWidgetHealthCheckScheduler(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    console.log('[widget-scheduler] Stopped');
  }
}
