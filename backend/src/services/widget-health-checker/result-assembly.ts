/**
 * Result assembly for widget health checks:
 * classify pass/fail/warning/timeout/error, capture/upload screenshots.
 */

import type { Browser, Page } from 'puppeteer-core';
import { getServiceSupabase } from '../../db/service-supabase.ts';
import type { WidgetHcTimeouts } from '../../types.ts';

const SCREENSHOT_BUCKET = 'widget-hc-screenshots';
const MAX_RESPONSE_STORED = 500;

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

export function isTransientError(message: string): boolean {
  return TRANSIENT_ERROR_PATTERNS.some((p) => message.includes(p));
}

export async function captureScreenshot(page: Page): Promise<Buffer | null> {
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

/** Best-effort screenshot of the last open page on a browser. */
export async function captureScreenshotFromBrowser(browser: Browser): Promise<Buffer | null> {
  try {
    const pages = await browser.pages();
    const lastPage = pages[pages.length - 1];
    if (!lastPage) return null;
    return captureScreenshot(lastPage);
  } catch {
    return null;
  }
}

export async function uploadScreenshot(
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

export function truncateResponse(text: string): string {
  return text.slice(0, MAX_RESPONSE_STORED);
}

/** Build a fail result when a configured error pattern matches the AI reply. */
export function assembleErrorPatternFail(args: {
  responseTimeMs: number;
  pageLoadTimeMs: number | null;
  widgetLoadTimeMs: number | null;
  aiResponseTimeMs: number | null;
  matchedError: string;
  responseText: string;
  screenshotBuffer: Buffer | null;
}): WidgetHealthCheckResult {
  return {
    status: 'fail',
    responseTimeMs: args.responseTimeMs,
    pageLoadTimeMs: args.pageLoadTimeMs,
    widgetLoadTimeMs: args.widgetLoadTimeMs,
    aiResponseTimeMs: args.aiResponseTimeMs,
    errorMessage: `Error pattern matched: "${args.matchedError}"`,
    rawResponse: truncateResponse(args.responseText),
    screenshotBuffer: args.screenshotBuffer,
  };
}

/** Classify a completed probe as pass or warning based on slow thresholds. */
export function assemblePassOrWarning(args: {
  responseTimeMs: number;
  pageLoadTimeMs: number;
  widgetLoadTimeMs: number;
  aiResponseTimeMs: number;
  responseText: string;
  timeouts: WidgetHcTimeouts;
}): WidgetHealthCheckResult {
  const warnings: string[] = [];
  if (args.pageLoadTimeMs > args.timeouts.slow_page_load_ms) {
    warnings.push(`page load ${Math.round(args.pageLoadTimeMs / 1000)}s`);
  }
  if (args.widgetLoadTimeMs > args.timeouts.slow_widget_load_ms) {
    warnings.push(`widget load ${Math.round(args.widgetLoadTimeMs / 1000)}s`);
  }
  if (args.aiResponseTimeMs > args.timeouts.slow_response_ms) {
    warnings.push(`AI response ${Math.round(args.aiResponseTimeMs / 1000)}s`);
  }

  const status = warnings.length > 0 ? 'warning' : 'pass';
  const errorMessage = warnings.length > 0 ? `Slow: ${warnings.join(', ')}` : null;

  return {
    status,
    responseTimeMs: args.responseTimeMs,
    pageLoadTimeMs: args.pageLoadTimeMs,
    widgetLoadTimeMs: args.widgetLoadTimeMs,
    aiResponseTimeMs: args.aiResponseTimeMs,
    errorMessage,
    rawResponse: truncateResponse(args.responseText),
    screenshotBuffer: null,
  };
}

/** Classify a thrown error into error / timeout / fail with phase timings. */
export function assembleCaughtFailure(args: {
  responseTimeMs: number;
  pageLoadTimeMs: number | null;
  widgetLoadTimeMs: number | null;
  aiResponseTimeMs: number | null;
  message: string;
  screenshotBuffer: Buffer | null;
}): WidgetHealthCheckResult {
  const isToolingError = isTransientError(args.message);
  const isTimeout = !isToolingError && (args.message.includes('timed out') || args.message.includes('Timeout'));
  const failedInPreAiPhase = args.pageLoadTimeMs === null || args.widgetLoadTimeMs === null;

  const status: WidgetHealthCheckResult['status'] =
    isToolingError || failedInPreAiPhase ? 'error' : isTimeout ? 'timeout' : 'fail';

  return {
    status,
    responseTimeMs: args.responseTimeMs,
    pageLoadTimeMs: args.pageLoadTimeMs,
    widgetLoadTimeMs: args.widgetLoadTimeMs,
    aiResponseTimeMs: args.aiResponseTimeMs,
    errorMessage: args.message,
    rawResponse: null,
    screenshotBuffer: args.screenshotBuffer,
  };
}

export function emptyErrorResult(errorMessage: string): WidgetHealthCheckResult {
  return {
    status: 'error',
    responseTimeMs: 0,
    pageLoadTimeMs: null,
    widgetLoadTimeMs: null,
    aiResponseTimeMs: null,
    errorMessage,
    rawResponse: null,
    screenshotBuffer: null,
  };
}
