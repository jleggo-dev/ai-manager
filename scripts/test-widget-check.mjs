/**
 * End-to-end local test of the widget health check flow.
 * Mirrors the exact phases in widget-health-checker.ts.
 */
import puppeteer from 'puppeteer';

const url = 'https://www.appdirect.com';
const SHADOW_HOST = '#appdirect-ai-embedded-root';
const LAUNCHER = 'button[class*="appdirect-ai-Button"]';
const IFRAME = 'iframe[class*="appdirect-ai-Iframe"]';
const INPUT = '#chat-input, textarea';
const SEND = 'div[class*="inputBackground"] button:last-of-type, button.mantine-ActionIcon-root:last-of-type';
const RESPONSE = '.markdown-chat-message, [class*="chat-message"]';
const TEST_MESSAGE = 'Hello, can you help me?';

const start = Date.now();
function elapsed() { return `${((Date.now() - start) / 1000).toFixed(1)}s`; }

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 720 });

  // Phase 1: Navigate
  console.log(`[${elapsed()}] Phase 1: Navigating to ${url}`);
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
  } catch (e) {
    console.log(`[${elapsed()}] Navigation warning: ${e.message}, continuing...`);
  }
  await page.waitForFunction(() => document.readyState === 'complete', { timeout: 30000 });
  console.log(`[${elapsed()}] Page loaded`);

  // Phase 2: Settle
  await new Promise((r) => setTimeout(r, 2000));

  // Phase 3: Shadow DOM — get shadow root
  console.log(`[${elapsed()}] Phase 3: Getting shadow root`);
  const shadowRoot = await page.evaluateHandle((sel) => {
    return document.querySelector(sel)?.shadowRoot ?? null;
  }, SHADOW_HOST);
  const hasShadow = await page.evaluate((v) => v !== null, shadowRoot);
  if (!hasShadow) throw new Error('No shadow root found');
  console.log(`[${elapsed()}] Shadow root found`);

  // Find launcher in shadow root
  console.log(`[${elapsed()}] Finding launcher: ${LAUNCHER}`);
  const launcherEl = await page.evaluateHandle(
    (sr, sel) => sr.querySelector(sel), shadowRoot, LAUNCHER.split(',')[0].trim()
  );
  const hasLauncher = await page.evaluate((v) => v !== null, launcherEl);
  if (!hasLauncher) throw new Error('Launcher not found');

  // Click launcher via DOM
  await page.evaluate((el) => el.click(), launcherEl);
  console.log(`[${elapsed()}] Launcher clicked`);
  await new Promise((r) => setTimeout(r, 2000));

  // Phase 4: Find iframe in shadow root
  console.log(`[${elapsed()}] Phase 4: Finding iframe: ${IFRAME}`);
  const iframeEl = await page.evaluateHandle(
    (sr, sel) => sr.querySelector(sel), shadowRoot, IFRAME.split(',')[0].trim()
  );
  const hasIframe = await page.evaluate((v) => v !== null, iframeEl);
  if (!hasIframe) throw new Error('Iframe not found');

  const frame = await iframeEl.contentFrame();
  if (!frame) throw new Error('Cannot access iframe content');
  console.log(`[${elapsed()}] Iframe found and accessible`);

  // Phase 5: Wait for iframe content
  await new Promise((r) => setTimeout(r, 4000));

  // Phase 6: Count existing messages
  const selectors = RESPONSE.split(',').map(s => s.trim());
  const selectorGroup = selectors.join(', ');
  const msgCountBefore = await frame.evaluate((sel) => document.querySelectorAll(sel).length, selectorGroup);
  console.log(`[${elapsed()}] Phase 6: ${msgCountBefore} existing messages`);

  // Phase 7: Type message
  console.log(`[${elapsed()}] Phase 7: Typing message`);
  const inputSels = INPUT.split(',').map(s => s.trim());
  let inputEl = null;
  for (const sel of inputSels) {
    inputEl = await frame.$(sel);
    if (inputEl) break;
  }
  if (!inputEl) throw new Error(`Input not found. Tried: ${INPUT}`);
  await inputEl.click();
  await inputEl.type(TEST_MESSAGE, { delay: 30 });
  console.log(`[${elapsed()}] Message typed`);

  // Phase 8: Click send
  console.log(`[${elapsed()}] Phase 8: Clicking send`);
  const sendSels = SEND.split(',').map(s => s.trim());
  let sendClicked = false;
  for (const sel of sendSels) {
    try {
      const result = await frame.evaluate((s) => {
        const el = document.querySelector(s);
        if (el) { el.click(); return true; }
        return false;
      }, sel);
      if (result) { sendClicked = true; console.log(`[${elapsed()}] Send clicked via: ${sel}`); break; }
    } catch {}
  }
  if (!sendClicked) throw new Error(`Send button not found. Tried: ${SEND}`);

  // Phase 9: Wait for new response
  console.log(`[${elapsed()}] Phase 9: Waiting for response...`);
  await frame.waitForFunction(
    (sel, prevCount) => document.querySelectorAll(sel).length > prevCount,
    { timeout: 60000 },
    selectorGroup,
    msgCountBefore
  );
  console.log(`[${elapsed()}] New message detected`);

  // Phase 10: Wait for stable response
  let lastContent = '';
  let stableCount = 0;
  while (stableCount < 3) {
    await new Promise((r) => setTimeout(r, 500));
    const currentContent = await frame.evaluate((sel) => {
      const msgs = document.querySelectorAll(sel);
      return msgs[msgs.length - 1]?.textContent?.trim() || '';
    }, selectorGroup);
    if (currentContent === lastContent && currentContent.length > 0) {
      stableCount++;
    } else {
      stableCount = 0;
      lastContent = currentContent;
    }
  }

  console.log(`\n✅ PASS [${elapsed()}]`);
  console.log(`Response: ${lastContent.slice(0, 200)}`);
} catch (err) {
  console.log(`\n❌ FAIL [${elapsed()}]: ${err.message}`);
  process.exitCode = 1;
} finally {
  await browser.close();
}
