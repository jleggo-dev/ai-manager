/**
 * Service – Health Check Scheduler
 * ----------------------------------
 * A lightweight in-process scheduler that polls for due health checks
 * every 60 seconds and executes them. Uses the service-role Supabase
 * client so it runs outside any user auth context.
 *
 * Start via `startHealthCheckScheduler()` during server boot.
 */

import { listDueChecks } from '../models/health-checks.ts';
import { runAndRecordCheck } from './health-checker.ts';

const POLL_INTERVAL_MS = 60_000;
let intervalHandle: ReturnType<typeof setInterval> | null = null;

async function tick(): Promise<void> {
  try {
    const dueChecks = await listDueChecks();
    if (dueChecks.length === 0) return;

    console.log(`[health-scheduler] ${dueChecks.length} check(s) due`);

    const settled = await Promise.allSettled(
      dueChecks.map((check) =>
        runAndRecordCheck(check).catch((err: unknown) => {
          console.error(`[health-scheduler] check ${check.id} failed:`, err);
        }),
      ),
    );

    const failures = settled.filter((r) => r.status === 'rejected');
    if (failures.length > 0) {
      console.warn(`[health-scheduler] ${failures.length} check(s) errored out`);
    }
  } catch (err: unknown) {
    console.error('[health-scheduler] tick error:', err);
  }
}

export function startHealthCheckScheduler(): void {
  if (intervalHandle) return;
  console.log('[health-scheduler] Starting (poll every 60s)');
  intervalHandle = setInterval(tick, POLL_INTERVAL_MS);
  /* Run once on startup after a short delay so the server is fully ready */
  setTimeout(tick, 5_000);
}

export function stopHealthCheckScheduler(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
    console.log('[health-scheduler] Stopped');
  }
}
