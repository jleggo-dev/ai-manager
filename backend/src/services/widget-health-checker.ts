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
 */

import type { Browser, Page, Frame, ElementHandle, JSHandle } from 'puppeteer-core';
import { launchBrowser, probeBrowserAvailability } from '../lib/browser.ts';
import { validateSafeUrl } from '../lib/url-validator.ts';
import { Semaphore } from '../lib/semaphore.ts';
import { resolveTimeouts } from '../lib/widget-hc-timeouts.ts';
import { getServiceSupabase } from '../db/service-supabase.ts';
import {
  serviceInsertWidgetRun,
  serviceUpdateWidgetCheckLastRun,
  serviceGetOpenWidgetIncident,
  serviceOpenWidgetIncident,
  serviceUpdateWidgetIncident,
  serviceResolveWidgetIncident,
} from '../models/widget-health-checks.ts';
import type { WidgetHealthCheckRow, WidgetHealthCheckRunRow, WidgetHcTimeouts } from '../types.ts';

const SCREENSHOT_BUCKET = 'widget-hc-screenshots';

const MAX_RESPONSE_STORED = 500;
const HARD_TIMEOUT_BUFFER_MS = 30_000;
const SETTLE_DELAY_MS = 3_000;

const TRANSIENT_ERROR_PATTERNS = [
  'ETXTBSY',
  'ERR_SOCKET_NOT_CONNECTED',
  'ERR_NETWORK_CHANGED',
  'ERR_CONNECTION_RESET',
  'ERR_CONNECTION_REFUSED',
  'ECONNREFUSED',
  'ECONNRESET',
  'Protocol error',
  'Target closed',
  'Session closed',
  'Execution context was destroyed',
  'detached Frame',
  'Element not found',
  'Element not found in shadow DOM',
  'Shadow host',
  'has no shadowRoot',
  'Runtime.callFunction',
  'protocolTimeout',
];

function isTransientError(message: string): boolean {
  return TRANSIENT_ERROR_PATTERNS.some((p) => message.includes(p));
}

const STABILITY_CHECK_MS = 500;
const STABILITY_THRESHOLD = 3;

const browserSemaphore = new Semaphore(Number(process.env.WIDGET_HC_MAX_CONCURRENT || '3'));

let puppeteerAvailable = true;

export interface WidgetHealthCheckResult {
  status: 'pass' | 'fail' | 'timeout' | 'error' | 'warning';
  responseTimeMs: number;
  pageLoadTimeMs: number | null;
  widgetLoadTimeMs: number | null;
  aiResponseTimeMs: number | null;
  errorMessage: string | null;
  rawResponse: string | null;
  screenshotBuffer: Buffer | null;
}

function whcLog(level: 'info' | 'warn' | 'error', checkId: string, msg: string, extra?: Record<string, unknown>): void {
  const entry = { component: 'widget-health-checker', checkId, msg, ...extra };
  console[level](`[widget-hc] ${JSON.stringify(entry)}`);
}

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

async function findWithFallback(context: Page | Frame, selectorList: string, timeoutMs: number): Promise<string> {
  const selectors = selectorList
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  for (const sel of selectors) {
    try {
      await context.waitForSelector(sel, { timeout: Math.min(timeoutMs, 5000), visible: true });
      return sel;
    } catch {
      continue;
    }
  }
  throw new Error(`Element not found. Tried: ${selectors.join(', ')}`);
}

async function getShadowRoot(page: Page, hostSelector: string, timeoutMs: number): Promise<JSHandle<ShadowRoot>> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const handle = await page.evaluateHandle((sel: string) => {
      const host = document.querySelector(sel);
      return host?.shadowRoot ?? null;
    }, hostSelector);

    const isNull = await page.evaluate((v) => v === null, handle);
    if (!isNull) return handle as JSHandle<ShadowRoot>;

    await handle.dispose();
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Shadow host "${hostSelector}" not found or has no shadowRoot within ${timeoutMs}ms`);
}

async function findInShadowRoot(
  page: Page,
  shadowRoot: JSHandle<ShadowRoot>,
  selectorList: string,
  timeoutMs: number,
): Promise<ElementHandle<Element>> {
  const selectors = selectorList
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const sel of selectors) {
      const handle = await page.evaluateHandle((sr: ShadowRoot, s: string) => sr.querySelector(s), shadowRoot, sel);
      const isNull = await page.evaluate((v) => v === null, handle);
      if (!isNull) return handle as ElementHandle<Element>;
      await handle.dispose();
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Element not found in shadow DOM. Tried: ${selectors.join(', ')}`);
}

/**
 * Execute a single widget health check via Puppeteer with three-phase timing.
 */
export async function executeWidgetHealthCheck(
  check: WidgetHealthCheckRow,
  timeouts: WidgetHcTimeouts,
): Promise<WidgetHealthCheckResult> {
  const start = Date.now();
  let browser: Browser | null = null;
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

    browser = await launchBrowser({ timeout: hardTimeoutMs });

    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 720 });

    page.on('popup', async (popup) => {
      try {
        await popup?.close();
      } catch {
        /* ignore */
      }
    });

    const hardKillTimer = setTimeout(() => {
      browser?.close().catch(() => {});
    }, hardTimeoutMs);

    try {
      // ─── Phase 1: Page Load ───────────────────────────────
      const phase1Start = Date.now();
      whcLog('info', check.id, 'Phase 1: Navigating to page');

      await page.goto(check.url, {
        waitUntil: 'networkidle2',
        timeout: timeouts.page_load_timeout_ms,
      });

      await page.waitForFunction(() => document.readyState === 'complete', {
        timeout: timeouts.page_load_timeout_ms,
      });

      await new Promise((r) => setTimeout(r, SETTLE_DELAY_MS));
      pageLoadTimeMs = Date.now() - phase1Start;
      whcLog('info', check.id, 'Phase 1 complete', { pageLoadTimeMs });

      // ─── Phase 2: Widget Load ─────────────────────────────
      const phase2Start = Date.now();
      const widgetTimeout = timeouts.widget_load_timeout_ms;
      whcLog('info', check.id, 'Phase 2: Finding widget');

      let frame: Frame;

      if (check.shadow_host_selector) {
        whcLog('info', check.id, 'Using shadow DOM traversal', { host: check.shadow_host_selector });

        const shadowRoot = await getShadowRoot(page, check.shadow_host_selector, widgetTimeout);

        const launcherEl = await findInShadowRoot(page, shadowRoot, check.launcher_selector, widgetTimeout);
        await page.evaluate((el) => (el as HTMLElement).click(), launcherEl);
        await new Promise((r) => setTimeout(r, SETTLE_DELAY_MS));

        const remaining = Math.max(widgetTimeout - (Date.now() - phase2Start), 5_000);
        const iframeEl = await findInShadowRoot(page, shadowRoot, check.iframe_selector, remaining);

        const iframeFrame = await (iframeEl as ElementHandle<HTMLIFrameElement>).contentFrame();
        if (!iframeFrame) {
          throw new Error('Could not access widget iframe content from shadow DOM — may be cross-origin restricted');
        }
        frame = iframeFrame;
      } else {
        whcLog('info', check.id, 'Looking for widget launcher (direct DOM)');
        const launcherSel = await findWithFallback(page, check.launcher_selector, widgetTimeout);
        await page.click(launcherSel);

        const remaining = Math.max(widgetTimeout - (Date.now() - phase2Start), 5_000);
        const iframeSel = await findWithFallback(page, check.iframe_selector, remaining);
        const iframeHandle = await page.waitForSelector(iframeSel, { timeout: remaining });

        if (!iframeHandle) {
          throw new Error('Widget iframe element found but handle is null');
        }

        const directFrame = await iframeHandle.contentFrame();
        if (!directFrame) {
          throw new Error('Could not access widget iframe content — may be cross-origin restricted');
        }
        frame = directFrame;
      }

      await new Promise((r) => setTimeout(r, SETTLE_DELAY_MS * 2));

      const responseSelectors = check.response_selector
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      const selectorGroup = responseSelectors.join(', ');
      const messageCountBefore = await frame.evaluate((sel: string) => {
        return document.querySelectorAll(sel).length;
      }, selectorGroup);

      const inputRemaining = Math.max(widgetTimeout - (Date.now() - phase2Start), 5_000);
      const inputSel = await findWithFallback(frame, check.input_selector, inputRemaining);
      const inputEl = await frame.$(inputSel);
      if (!inputEl) throw new Error('Chat input element not found after selector match');

      widgetLoadTimeMs = Date.now() - phase2Start;
      whcLog('info', check.id, 'Phase 2 complete', { widgetLoadTimeMs });

      // ─── Phase 3: AI Response ─────────────────────────────
      const phase3Start = Date.now();
      whcLog('info', check.id, 'Phase 3: Sending test message');

      const tagName = await frame.evaluate((el: Element) => el.tagName.toLowerCase(), inputEl);
      const isContentEditable = await frame.evaluate(
        (el: Element) => (el as HTMLElement).contentEditable === 'true',
        inputEl,
      );

      if (tagName === 'textarea' || tagName === 'input') {
        await inputEl.click();
        await inputEl.type(check.test_message, { delay: 30 });
      } else if (isContentEditable) {
        await inputEl.click();
        await frame.evaluate(
          (el: Element, text: string) => {
            (el as HTMLElement).textContent = text;
            el.dispatchEvent(new Event('input', { bubbles: true }));
          },
          inputEl,
          check.test_message,
        );
      } else {
        throw new Error(`Unsupported input element: <${tagName}>`);
      }

      whcLog('info', check.id, 'Submitting message');
      await inputEl.press('Enter');
      await new Promise((r) => setTimeout(r, 2_000));

      const countAfterEnter = await frame.evaluate(
        (sel: string) => document.querySelectorAll(sel).length,
        selectorGroup,
      );

      if (countAfterEnter <= messageCountBefore) {
        whcLog('info', check.id, 'Enter did not send, clicking send button');
        const sendSel = await findWithFallback(frame, check.send_selector, 5_000);
        await frame.click(sendSel);
      }

      whcLog('info', check.id, 'Waiting for response');
      await frame.waitForFunction(
        (sel: string, prevCount: number) => {
          const msgs = document.querySelectorAll(sel);
          return msgs.length > prevCount;
        },
        { timeout: timeouts.response_timeout_ms },
        selectorGroup,
        messageCountBefore,
      );

      let lastContent = '';
      let stableCount = 0;
      while (stableCount < STABILITY_THRESHOLD) {
        await new Promise((r) => setTimeout(r, STABILITY_CHECK_MS));
        const currentContent = await frame.evaluate((sel: string) => {
          const msgs = document.querySelectorAll(sel);
          const last = msgs[msgs.length - 1];
          return last?.textContent?.trim() || '';
        }, selectorGroup);

        if (currentContent === lastContent && currentContent.length > 0) {
          stableCount++;
        } else {
          stableCount = 0;
          lastContent = currentContent;
        }
      }

      aiResponseTimeMs = Date.now() - phase3Start;
      whcLog('info', check.id, 'Phase 3 complete', { aiResponseTimeMs });

      const responseTimeMs = Date.now() - start;
      const responseText = lastContent;

      // ─── Check for error patterns ─────────────────────────
      const errorPatterns = check.error_patterns || [];
      const matchedError = errorPatterns.find((pattern) => responseText.toLowerCase().includes(pattern.toLowerCase()));

      if (matchedError) {
        whcLog('warn', check.id, 'Error pattern detected in response', { matchedError });
        if (check.capture_screenshot) {
          screenshotBuffer = await captureScreenshot(page);
        }
        return {
          status: 'fail',
          responseTimeMs,
          pageLoadTimeMs,
          widgetLoadTimeMs,
          aiResponseTimeMs,
          errorMessage: `Error pattern matched: "${matchedError}"`,
          rawResponse: responseText.slice(0, MAX_RESPONSE_STORED),
          screenshotBuffer,
        };
      }

      // ─── Classify: pass vs warning (per-phase slow thresholds) ─
      const warnings: string[] = [];
      if (pageLoadTimeMs > timeouts.slow_page_load_ms) {
        warnings.push(`page load ${Math.round(pageLoadTimeMs / 1000)}s`);
      }
      if (widgetLoadTimeMs > timeouts.slow_widget_load_ms) {
        warnings.push(`widget load ${Math.round(widgetLoadTimeMs / 1000)}s`);
      }
      if (aiResponseTimeMs > timeouts.slow_response_ms) {
        warnings.push(`AI response ${Math.round(aiResponseTimeMs / 1000)}s`);
      }

      const status = warnings.length > 0 ? 'warning' : 'pass';
      const errorMessage = warnings.length > 0 ? `Slow: ${warnings.join(', ')}` : null;
      whcLog('info', check.id, `Check ${status}`, {
        responseTimeMs,
        pageLoadTimeMs,
        widgetLoadTimeMs,
        aiResponseTimeMs,
      });

      return {
        status,
        responseTimeMs,
        pageLoadTimeMs,
        widgetLoadTimeMs,
        aiResponseTimeMs,
        errorMessage,
        rawResponse: responseText.slice(0, MAX_RESPONSE_STORED),
        screenshotBuffer: null,
      };
    } finally {
      clearTimeout(hardKillTimer);
    }
  } catch (err: unknown) {
    const responseTimeMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    const isToolingError = isTransientError(message);
    const isTimeout = !isToolingError && (message.includes('timed out') || message.includes('Timeout'));

    const failedInPreAiPhase = pageLoadTimeMs === null || widgetLoadTimeMs === null;
    const phase = pageLoadTimeMs === null ? 'page_load' : widgetLoadTimeMs === null ? 'widget_load' : 'ai_response';

    whcLog('error', check.id, 'Check failed', { error: message, phase, isToolingError, failedInPreAiPhase });

    if (check.capture_screenshot && browser) {
      try {
        const pages = await browser.pages();
        const lastPage = pages[pages.length - 1];
        if (lastPage) {
          screenshotBuffer = await captureScreenshot(lastPage);
        }
      } catch {
        /* screenshot best-effort */
      }
    }

    const status: WidgetHealthCheckResult['status'] =
      isToolingError || failedInPreAiPhase ? 'error' : isTimeout ? 'timeout' : 'fail';

    return {
      status,
      responseTimeMs,
      pageLoadTimeMs,
      widgetLoadTimeMs,
      aiResponseTimeMs,
      errorMessage: message,
      rawResponse: null,
      screenshotBuffer,
    };
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
  }
}

async function captureScreenshot(page: Page): Promise<Buffer | null> {
  try {
    const result = await page.screenshot({
      type: 'jpeg',
      quality: 60,
      encoding: 'binary',
    });
    const buf = Buffer.isBuffer(result) ? result : Buffer.from(result);
    const maxSize = 5 * 1024 * 1024;
    if (buf.length > maxSize) return buf.subarray(0, maxSize);
    return buf;
  } catch {
    return null;
  }
}

async function uploadScreenshot(
  workspaceId: string,
  checkId: string,
  runId: string,
  buffer: Buffer,
): Promise<string | null> {
  try {
    const path = `${workspaceId}/${checkId}/${runId}.jpg`;
    const sb = getServiceSupabase();
    const { error } = await sb.storage
      .from(SCREENSHOT_BUCKET)
      .upload(path, buffer, { contentType: 'image/jpeg', upsert: true });
    if (error) {
      console.error('[widget-hc] Screenshot upload failed:', error.message);
      return null;
    }
    return path;
  } catch (err) {
    console.error('[widget-hc] Screenshot upload error:', err);
    return null;
  }
}

async function executeWithRetry(
  check: WidgetHealthCheckRow,
  timeouts: WidgetHcTimeouts,
): Promise<WidgetHealthCheckResult> {
  const configuredAttempts = Math.min(check.max_retries || 1, 3);
  const maxTransientAttempts = 3;
  let lastResult: WidgetHealthCheckResult = {
    status: 'error',
    responseTimeMs: 0,
    pageLoadTimeMs: null,
    widgetLoadTimeMs: null,
    aiResponseTimeMs: null,
    errorMessage: 'No attempts executed',
    rawResponse: null,
    screenshotBuffer: null,
  };

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
