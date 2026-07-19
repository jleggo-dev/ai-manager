/**
 * Widget interaction for health checks:
 * locate launcher/iframe/input (direct DOM or shadow DOM), send probe, await reply.
 */

import type { Page, Frame, ElementHandle, JSHandle } from 'puppeteer-core';
import type { WidgetHealthCheckRow } from '../../types.ts';
import { SETTLE_DELAY_MS } from './browser-session.ts';
import { whcLog } from './log.ts';

const STABILITY_CHECK_MS = 500;
const STABILITY_THRESHOLD = 3;

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

export interface OpenedWidget {
  frame: Frame;
  inputEl: ElementHandle<Element>;
  selectorGroup: string;
  messageCountBefore: number;
  widgetLoadTimeMs: number;
}

/**
 * Phase 2 — find widget launcher, open iframe, locate chat input.
 * Returns the live frame/input handles plus a baseline message count for Phase 3.
 */
export async function openWidgetChat(
  page: Page,
  check: WidgetHealthCheckRow,
  widgetTimeout: number,
): Promise<OpenedWidget> {
  const phase2Start = Date.now();
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

  const widgetLoadTimeMs = Date.now() - phase2Start;
  whcLog('info', check.id, 'Phase 2 complete', { widgetLoadTimeMs });

  return { frame, inputEl, selectorGroup, messageCountBefore, widgetLoadTimeMs };
}

/**
 * Phase 3 — type test message, send, wait for a new response bubble, wait for content stability.
 */
export async function sendProbeAndAwaitResponse(
  frame: Frame,
  inputEl: ElementHandle<Element>,
  check: WidgetHealthCheckRow,
  selectorGroup: string,
  messageCountBefore: number,
  responseTimeoutMs: number,
): Promise<{ responseText: string; aiResponseTimeMs: number }> {
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

  const countAfterEnter = await frame.evaluate((sel: string) => document.querySelectorAll(sel).length, selectorGroup);

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
    { timeout: responseTimeoutMs },
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

  const aiResponseTimeMs = Date.now() - phase3Start;
  whcLog('info', check.id, 'Phase 3 complete', { aiResponseTimeMs });

  return { responseText: lastContent, aiResponseTimeMs };
}
