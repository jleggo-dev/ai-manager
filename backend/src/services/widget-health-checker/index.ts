/**
 * Service – Widget Health Checker
 * --------------------------------
 * Executes widget health checks by launching a headless Chrome
 * instance via Puppeteer, navigating to a page with an embedded
 * chat widget, sending a test message, and verifying the response.
 *
 * Three-phase timing model:
 *   Phase 1 — Page Load:   Navigate to URL, wait for document ready + settle
 *   Phase 2 — Widget Load: Find launcher, click, find iframe + chat input
 *   Phase 3 — AI Response: Type message, send, wait for reply + stability
 *
 * Each phase has a configurable timeout and a slow-response warning threshold.
 * Global defaults live in app_settings (key: widget_hc_timeouts); individual
 * checks can override timeouts via nullable per-check columns.
 *
 * Also manages the incident state machine:
 *   HEALTHY  → fail  → open incident
 *   INCIDENT → fail  → update failed_run_count
 *   INCIDENT → pass  → resolve incident
 *
 * Implementation is split across:
 *   browser-session.ts   — launch / Phase 1 navigate / teardown
 *   widget-interaction.ts — Phase 2 open widget + Phase 3 probe
 *   result-assembly.ts   — classify result + screenshot capture/upload
 */

import { probeBrowserAvailability } from '../../lib/browser.ts';
import { validateSafeUrl } from '../../lib/url-validator.ts';
import { Semaphore } from '../../lib/semaphore.ts';
import { resolveTimeouts } from '../../lib/widget-hc-timeouts.ts';
import { getServiceSupabase } from '../../db/service-supabase.ts';
import {
  serviceInsertWidgetRun,
  serviceUpdateWidgetCheckLastRun,
  serviceGetOpenWidgetIncident,
  serviceOpenWidgetIncident,
  serviceUpdateWidgetIncident,
  serviceResolveWidgetIncident,
} from '../../models/widget-health-checks.ts';
import type { WidgetHealthCheckRow, WidgetHealthCheckRunRow, WidgetHcTimeouts } from '../../types.ts';
import {
  HARD_TIMEOUT_BUFFER_MS,
  openBrowserSession,
  navigateToCheckUrl,
  clearHardKillTimer,
  closeBrowser,
  type BrowserSession,
} from './browser-session.ts';
import { openWidgetChat, sendProbeAndAwaitResponse } from './widget-interaction.ts';
import {
  type WidgetHealthCheckResult,
  isTransientError,
  captureScreenshot,
  captureScreenshotFromBrowser,
  uploadScreenshot,
  assembleErrorPatternFail,
  assemblePassOrWarning,
  assembleCaughtFailure,
  emptyErrorResult,
} from './result-assembly.ts';
import { whcLog } from './log.ts';

export type { WidgetHealthCheckResult };

const browserSemaphore = new Semaphore(Number(process.env.WIDGET_HC_MAX_CONCURRENT || '3'));

let puppeteerAvailable = true;

export async function probePuppeteer(): Promise<boolean> {
  const ok = await probeBrowserAvailability();
  puppeteerAvailable = ok;
  if (ok) {
    console.log('[widget-hc] Puppeteer probe OK — widget checks enabled');
  } else {
    console.warn('[widget-hc] Puppeteer/Chromium unavailable — widget checks disabled');
  }
  return ok;
}

export function isPuppeteerAvailable(): boolean {
  return puppeteerAvailable;
}

/**
 * Execute a single widget health check via Puppeteer with three-phase timing.
 */
export async function executeWidgetHealthCheck(
  check: WidgetHealthCheckRow,
  timeouts: WidgetHcTimeouts,
): Promise<WidgetHealthCheckResult> {
  const start = Date.now();
  let session: BrowserSession | null = null;
  let screenshotBuffer: Buffer | null = null;
  let pageLoadTimeMs: number | null = null;
  let widgetLoadTimeMs: number | null = null;
  let aiResponseTimeMs: number | null = null;

  try {
    await validateSafeUrl(check.url, {
      allowedDomains: process.env.WIDGET_HC_ALLOWED_DOMAINS?.split(',').map((d) => d.trim()),
    });

    const hardTimeoutMs =
      timeouts.page_load_timeout_ms +
      timeouts.widget_load_timeout_ms +
      timeouts.response_timeout_ms +
      HARD_TIMEOUT_BUFFER_MS;

    whcLog('info', check.id, 'Starting widget check', {
      url: check.url,
      hardTimeoutMs,
      timeouts,
    });

    session = await openBrowserSession(hardTimeoutMs);
    const { page } = session;

    try {
      pageLoadTimeMs = await navigateToCheckUrl(page, check.id, check.url, timeouts.page_load_timeout_ms);

      const opened = await openWidgetChat(page, check, timeouts.widget_load_timeout_ms);
      widgetLoadTimeMs = opened.widgetLoadTimeMs;

      const probe = await sendProbeAndAwaitResponse(
        opened.frame,
        opened.inputEl,
        check,
        opened.selectorGroup,
        opened.messageCountBefore,
        timeouts.response_timeout_ms,
      );
      aiResponseTimeMs = probe.aiResponseTimeMs;

      const responseTimeMs = Date.now() - start;
      const responseText = probe.responseText;

      const errorPatterns = check.error_patterns || [];
      const matchedError = errorPatterns.find((pattern) => responseText.toLowerCase().includes(pattern.toLowerCase()));

      if (matchedError) {
        whcLog('warn', check.id, 'Error pattern detected in response', { matchedError });
        if (check.capture_screenshot) {
          screenshotBuffer = await captureScreenshot(page);
        }
        return assembleErrorPatternFail({
          responseTimeMs,
          pageLoadTimeMs,
          widgetLoadTimeMs,
          aiResponseTimeMs,
          matchedError,
          responseText,
          screenshotBuffer,
        });
      }

      const result = assemblePassOrWarning({
        responseTimeMs,
        pageLoadTimeMs,
        widgetLoadTimeMs,
        aiResponseTimeMs,
        responseText,
        timeouts,
      });
      whcLog('info', check.id, `Check ${result.status}`, {
        responseTimeMs,
        pageLoadTimeMs,
        widgetLoadTimeMs,
        aiResponseTimeMs,
      });
      return result;
    } finally {
      clearHardKillTimer(session);
    }
  } catch (err: unknown) {
    const responseTimeMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    const isToolingError = isTransientError(message);
    const failedInPreAiPhase = pageLoadTimeMs === null || widgetLoadTimeMs === null;
    const phase = pageLoadTimeMs === null ? 'page_load' : widgetLoadTimeMs === null ? 'widget_load' : 'ai_response';

    whcLog('error', check.id, 'Check failed', { error: message, phase, isToolingError, failedInPreAiPhase });

    if (check.capture_screenshot && session?.browser) {
      screenshotBuffer = await captureScreenshotFromBrowser(session.browser);
    }

    return assembleCaughtFailure({
      responseTimeMs,
      pageLoadTimeMs,
      widgetLoadTimeMs,
      aiResponseTimeMs,
      message,
      screenshotBuffer,
    });
  } finally {
    await closeBrowser(session?.browser ?? null);
  }
}

async function executeWithRetry(
  check: WidgetHealthCheckRow,
  timeouts: WidgetHcTimeouts,
): Promise<WidgetHealthCheckResult> {
  const configuredAttempts = Math.min(check.max_retries || 1, 3);
  const maxTransientAttempts = 3;
  let lastResult: WidgetHealthCheckResult = emptyErrorResult('No attempts executed');

  let attempt = 0;
  let transientRetries = 0;

  while (attempt < configuredAttempts || transientRetries < maxTransientAttempts) {
    attempt++;
    lastResult = await executeWidgetHealthCheck(check, timeouts);
    if (lastResult.status === 'pass') return lastResult;

    const transient = lastResult.errorMessage ? isTransientError(lastResult.errorMessage) : false;

    if (transient && transientRetries < maxTransientAttempts) {
      transientRetries++;
      whcLog('info', check.id, `Transient error (attempt ${attempt}), auto-retrying`, {
        error: lastResult.errorMessage,
      });
      await new Promise((r) => setTimeout(r, 3000 * transientRetries));
      continue;
    }

    if (attempt < configuredAttempts) {
      whcLog('info', check.id, `Attempt ${attempt}/${configuredAttempts} failed, retrying`, {
        status: lastResult.status,
      });
      await new Promise((r) => setTimeout(r, 2000 * attempt));
      continue;
    }

    break;
  }

  return lastResult;
}

/**
 * Run a widget health check: resolve timeouts, execute, persist results, update incident state.
 */
export async function runAndRecordWidgetCheck(check: WidgetHealthCheckRow): Promise<WidgetHealthCheckRunRow> {
  await browserSemaphore.acquire();
  try {
    const timeouts = await resolveTimeouts(check);
    const result = await executeWithRetry(check, timeouts);

    const run = await serviceInsertWidgetRun({
      widget_health_check_id: check.id,
      workspace_id: check.workspace_id,
      status: result.status,
      response_time_ms: result.responseTimeMs,
      page_load_time_ms: result.pageLoadTimeMs,
      widget_load_time_ms: result.widgetLoadTimeMs,
      ai_response_time_ms: result.aiResponseTimeMs,
      error_message: result.errorMessage,
      raw_response: result.rawResponse,
      screenshot_path: null,
    });

    if (result.screenshotBuffer) {
      const path = await uploadScreenshot(check.workspace_id, check.id, run.id, result.screenshotBuffer);
      if (path) {
        const sb = getServiceSupabase();
        await sb
          .from('widget_health_check_runs')
          .update({ screenshot_path: path })
          .eq('id', run.id)
          .eq('workspace_id', check.workspace_id)
          .then(({ error }) => {
            if (error) console.error('[widget-hc] Failed to update screenshot_path:', error.message);
          });
        run.screenshot_path = path;
      }
    }

    await serviceUpdateWidgetCheckLastRun(check.id);
    await updateWidgetIncidentState(check, result);

    return run;
  } finally {
    browserSemaphore.release();
  }
}

async function updateWidgetIncidentState(check: WidgetHealthCheckRow, result: WidgetHealthCheckResult): Promise<void> {
  if (result.status === 'error') return;

  const openIncident = await serviceGetOpenWidgetIncident(check.id);
  const passed = result.status === 'pass' || result.status === 'warning';

  if (passed && openIncident) {
    await serviceResolveWidgetIncident(openIncident.id, openIncident.started_at);
    return;
  }

  if (!passed && openIncident) {
    await serviceUpdateWidgetIncident(openIncident.id, {
      failed_run_count: openIncident.failed_run_count + 1,
      last_error: result.errorMessage,
    });
    return;
  }

  if (!passed && !openIncident) {
    await serviceOpenWidgetIncident(check.id, check.workspace_id, result.errorMessage);
  }
}
