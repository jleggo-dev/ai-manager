/**
 * Inspect the Devs.ai widget structure on appdirect.com
 * to discover the correct CSS selectors for health checks.
 *
 * Usage: node scripts/inspect-widget.mjs [url]
 */

import puppeteer from 'puppeteer';

const url = process.argv[2] || 'https://www.appdirect.com';
const SHADOW_HOST = '#appdirect-ai-embedded-root';

console.log(`\n🔍 Inspecting widget on: ${url}\n`);

const browser = await puppeteer.launch({ headless: false, args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 720 });

console.log('Navigating...');
try {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
} catch (e) {
  console.log('Initial navigation error (redirect?), waiting for settle...', e.message);
}
await new Promise((r) => setTimeout(r, 8000));
console.log('Final URL:', page.url());

// Step 1: Check shadow host
console.log(`\n--- Shadow Host: ${SHADOW_HOST} ---`);
const shadowInfo = await page.evaluate((sel) => {
  const host = document.querySelector(sel);
  if (!host) return { found: false };
  const sr = host.shadowRoot;
  if (!sr) return { found: true, hasShadowRoot: false };
  const children = Array.from(sr.children).map((el) => ({
    tag: el.tagName.toLowerCase(),
    id: el.id,
    className: el.className?.toString?.()?.slice(0, 100) || '',
    type: el.getAttribute('type'),
  }));
  return { found: true, hasShadowRoot: true, childCount: children.length, children };
}, SHADOW_HOST);
console.log(JSON.stringify(shadowInfo, null, 2));

if (!shadowInfo.hasShadowRoot) {
  console.log('No shadow root found. Exiting.');
  await browser.close();
  process.exit(1);
}

// Step 2: Find and click the launcher
console.log('\n--- Looking for launcher button ---');
const launcherInfo = await page.evaluate((sel) => {
  const host = document.querySelector(sel);
  const sr = host?.shadowRoot;
  if (!sr) return null;
  const candidates = [
    'button[class*="appdirect-ai-Button"]',
    'button[class*="Button"]',
    'button',
    '[role="button"]',
  ];
  for (const c of candidates) {
    const el = sr.querySelector(c);
    if (el) {
      return {
        selector: c,
        tag: el.tagName,
        className: el.className?.toString?.()?.slice(0, 200),
        text: el.textContent?.trim()?.slice(0, 100),
        visible: el.offsetParent !== null || el.getClientRects().length > 0,
      };
    }
  }
  return { candidates, noneMatched: true };
}, SHADOW_HOST);
console.log(JSON.stringify(launcherInfo, null, 2));

// Click launcher via shadow DOM
console.log('\nClicking launcher...');
await page.evaluate((sel) => {
  const host = document.querySelector(sel);
  const sr = host?.shadowRoot;
  const btn = sr?.querySelector('button[class*="Button"]') || sr?.querySelector('button');
  if (btn) btn.click();
}, SHADOW_HOST);
await new Promise((r) => setTimeout(r, 3000));

// Step 3: Find the iframe
console.log('\n--- Looking for iframe in shadow root ---');
const iframeInfo = await page.evaluate((sel) => {
  const host = document.querySelector(sel);
  const sr = host?.shadowRoot;
  if (!sr) return null;
  const candidates = [
    'iframe[class*="appdirect-ai-Iframe"]',
    'iframe[class*="Iframe"]',
    'iframe',
  ];
  for (const c of candidates) {
    const el = sr.querySelector(c);
    if (el) {
      return {
        selector: c,
        src: el.getAttribute('src'),
        className: el.className?.toString?.()?.slice(0, 200),
        width: el.offsetWidth,
        height: el.offsetHeight,
      };
    }
  }
  return { candidates, noneMatched: true };
}, SHADOW_HOST);
console.log(JSON.stringify(iframeInfo, null, 2));

// Step 4: Get iframe content and dump its DOM
console.log('\n--- Iframe content inspection ---');
const iframeHandle = await page.evaluateHandle((sel) => {
  const host = document.querySelector(sel);
  const sr = host?.shadowRoot;
  return sr?.querySelector('iframe[class*="Iframe"]') || sr?.querySelector('iframe');
}, SHADOW_HOST);

const frame = await iframeHandle.contentFrame();
if (frame) {
  await new Promise((r) => setTimeout(r, 4000));

  const innerDOM = await frame.evaluate(() => {
    function describe(el, depth = 0) {
      if (depth > 4) return [];
      const results = [];
      for (const child of el.children) {
        const info = {
          tag: child.tagName.toLowerCase(),
          id: child.id || undefined,
          className: child.className?.toString?.()?.slice(0, 150) || undefined,
          type: child.getAttribute('type') || undefined,
          role: child.getAttribute('role') || undefined,
          placeholder: child.getAttribute('placeholder') || undefined,
          text: child.children.length === 0 ? child.textContent?.trim()?.slice(0, 50) : undefined,
        };
        Object.keys(info).forEach((k) => info[k] === undefined && delete info[k]);
        if (child.children.length > 0) {
          info.children = describe(child, depth + 1);
        }
        results.push(info);
      }
      return results;
    }
    return describe(document.body);
  });
  console.log(JSON.stringify(innerDOM, null, 2));

  // Specifically look for inputs, textareas, buttons
  console.log('\n--- Interactive elements inside iframe ---');
  const interactiveEls = await frame.evaluate(() => {
    const selectors = [
      'input', 'textarea', 'button', '[contenteditable="true"]',
      '[role="textbox"]', '#chat-input', '[class*="input"]',
      '[class*="Input"]', '[class*="Form"]', '[class*="form"]',
      'form', '[type="submit"]',
    ];
    const results = {};
    for (const s of selectors) {
      const els = document.querySelectorAll(s);
      if (els.length > 0) {
        results[s] = Array.from(els).map((el) => ({
          tag: el.tagName.toLowerCase(),
          id: el.id || undefined,
          className: el.className?.toString?.()?.slice(0, 150) || undefined,
          type: el.getAttribute('type') || undefined,
          placeholder: el.getAttribute('placeholder') || undefined,
          role: el.getAttribute('role') || undefined,
          visible: el.offsetParent !== null || el.getClientRects().length > 0,
        }));
      }
    }
    return results;
  });
  console.log(JSON.stringify(interactiveEls, null, 2));
} else {
  console.log('Could not access iframe content (cross-origin?)');
}

console.log('\n✅ Inspection complete. Closing browser...');
await browser.close();
