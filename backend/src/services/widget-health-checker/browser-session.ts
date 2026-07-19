/**
 * Browser session lifecycle for widget health checks:
 * launch, page setup, Phase 1 navigation, and teardown.
 */

import type { Browser, Page } from 'puppeteer-core';
import { launchBrowser } from '../../lib/browser.ts';
import { whcLog } from './log.ts';

export const HARD_TIMEOUT_BUFFER_MS = 30_000;
export const SETTLE_DELAY_MS = 3_000;

export interface BrowserSession {
  browser: Browser;
  page: Page;
  hardKillTimer: ReturnType<typeof setTimeout>;
}

/**
 * Launch Chromium, open a page, and arm a hard-kill timer that closes
 * the browser if the overall check exceeds hardTimeoutMs.
 */
export async function openBrowserSession(hardTimeoutMs: number): Promise<BrowserSession> {
  const browser = await launchBrowser({ timeout: hardTimeoutMs });
  try {
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
      browser.close().catch(() => {});
    }, hardTimeoutMs);

    return { browser, page, hardKillTimer };
  } catch (err) {
    await browser.close().catch(() => {});
    throw err;
  }
}

/**
 * Phase 1 — navigate to URL, wait for document complete, settle.
 * Returns page-load duration in ms.
 */
export async function navigateToCheckUrl(
  page: Page,
  checkId: string,
  url: string,
  pageLoadTimeoutMs: number,
): Promise<number> {
  const phase1Start = Date.now();
  whcLog('info', checkId, 'Phase 1: Navigating to page');

  await page.goto(url, {
    waitUntil: 'networkidle2',
    timeout: pageLoadTimeoutMs,
  });

  await page.waitForFunction(() => document.readyState === 'complete', {
    timeout: pageLoadTimeoutMs,
  });

  await new Promise((r) => setTimeout(r, SETTLE_DELAY_MS));
  const pageLoadTimeMs = Date.now() - phase1Start;
  whcLog('info', checkId, 'Phase 1 complete', { pageLoadTimeMs });
  return pageLoadTimeMs;
}

/** Disarm the hard-kill timer (call when the check finishes or fails). */
export function clearHardKillTimer(session: BrowserSession): void {
  clearTimeout(session.hardKillTimer);
}

/** Best-effort browser close. */
export async function closeBrowser(browser: Browser | null): Promise<void> {
  if (browser) await browser.close().catch(() => {});
}
