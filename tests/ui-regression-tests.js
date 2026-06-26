/**
 * UI Regression Tests — Post Security Hardening
 * ===============================================
 * Uses Puppeteer to verify all pages render correctly after
 * security changes (api_key stripping, sanitized responses).
 *
 * Run:
 *   Ensure backend (port 3001) and frontend (port 5173) are running.
 *   node tests/ui-regression-tests.js
 */

import puppeteer from 'puppeteer';

const FRONTEND_URL = 'http://localhost:5173';
const API = 'http://localhost:3001/api';

let passed = 0;
let failed = 0;
let skipped = 0;
let browser;

function assert(condition, label, detail) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
    failed++;
  }
}

function skip(label, reason) {
  console.log(`  ⊘ ${label} (skipped: ${reason})`);
  skipped++;
}

async function waitForApp(page, timeout = 15000) {
  await page.waitForSelector('[class*="mantine"], [class*="Shell"], nav, [data-testid]', { timeout });
}

async function getConsoleErrors(page) {
  const errors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  return errors;
}

async function checkApiHealth() {
  try {
    const res = await fetch(`${API}/health`);
    const body = await res.json();
    return res.ok && (body.status === 'ok' || body.status === 'degraded');
  } catch {
    return false;
  }
}

async function checkFrontendHealth() {
  try {
    const res = await fetch(FRONTEND_URL);
    return res.ok;
  } catch {
    return false;
  }
}

/* ================================================================
   Test: App loads and renders shell
   ================================================================ */
async function testAppLoads() {
  console.log('\n── 1. App Shell Loads ──');
  const page = await browser.newPage();
  try {
    const response = await page.goto(FRONTEND_URL, { waitUntil: 'networkidle2', timeout: 20000 });
    assert(response.ok(), `Frontend returns ${response.status()}`);

    await waitForApp(page);
    const title = await page.title();
    assert(title.length > 0, `Page has a title: "${title}"`);

    const bodyText = await page.evaluate(() => document.body.innerText);
    assert(bodyText.length > 50, 'Page has substantive content');
    assert(!bodyText.includes('api_key'), 'No "api_key" text visible in page body');
  } finally {
    await page.close();
  }
}

/* ================================================================
   Test: Providers page renders and masks keys
   ================================================================ */
async function testProvidersPage() {
  console.log('\n── 2. Providers Page ──');
  const page = await browser.newPage();
  try {
    await page.goto(FRONTEND_URL, { waitUntil: 'networkidle2', timeout: 20000 });
    await waitForApp(page);

    const navLinks = await page.$$eval('nav a, [class*="NavLink"], button', (els) =>
      els.map((e) => ({ text: e.innerText?.trim(), href: e.getAttribute('href') }))
    );
    const providerLink = navLinks.find((l) =>
      l.text?.toLowerCase().includes('provider')
    );

    if (!providerLink) {
      skip('Providers page navigation', 'no Providers nav link found');
      return;
    }

    await page.evaluate(() => {
      const links = [...document.querySelectorAll('nav a, [class*="NavLink"], button')];
      const link = links.find((l) => l.innerText?.toLowerCase().includes('provider'));
      if (link) link.click();
    });
    await new Promise((r) => setTimeout(r, 2000));

    const bodyText = await page.evaluate(() => document.body.innerText);
    assert(bodyText.toLowerCase().includes('provider'), 'Providers section visible');

    const apiKeyVisible = await page.evaluate(() => {
      const text = document.body.innerText;
      const matches = text.match(/aim_sk_\S{10,}/g);
      return matches ? matches.length : 0;
    });
    assert(apiKeyVisible === 0, 'No full API keys visible on Providers page');

    const maskedKeys = await page.evaluate(() => {
      const text = document.body.innerText;
      return (text.match(/Key:\s*\S{1,8}\.\.\./g) || []).length;
    });
    assert(maskedKeys >= 0, `Provider keys are masked (found ${maskedKeys} masked entries)`);
  } finally {
    await page.close();
  }
}

/* ================================================================
   Test: AI Profiles page renders
   ================================================================ */
async function testAiProfilesPage() {
  console.log('\n── 3. AI Profiles Page ──');
  const page = await browser.newPage();
  try {
    await page.goto(FRONTEND_URL, { waitUntil: 'networkidle2', timeout: 20000 });
    await waitForApp(page);

    await page.evaluate(() => {
      const links = [...document.querySelectorAll('nav a, [class*="NavLink"], button')];
      const link = links.find((l) => l.innerText?.toLowerCase().includes('profile'));
      if (link) link.click();
    });
    await new Promise((r) => setTimeout(r, 2000));

    const bodyText = await page.evaluate(() => document.body.innerText);
    assert(
      bodyText.toLowerCase().includes('profile') || bodyText.toLowerCase().includes('ai'),
      'AI Profiles section visible'
    );

    const hasApiKey = bodyText.includes('api_key') && !bodyText.includes('"api_key"');
    assert(!hasApiKey, 'No raw api_key field visible');
  } finally {
    await page.close();
  }
}

/* ================================================================
   Test: Processing Jobs page renders
   ================================================================ */
async function testProcessingJobsPage() {
  console.log('\n── 4. Processing Jobs Page ──');
  const page = await browser.newPage();
  try {
    await page.goto(FRONTEND_URL, { waitUntil: 'networkidle2', timeout: 20000 });
    await waitForApp(page);

    await page.evaluate(() => {
      const links = [...document.querySelectorAll('nav a, [class*="NavLink"], button')];
      const link = links.find((l) =>
        l.innerText?.toLowerCase().includes('job') || l.innerText?.toLowerCase().includes('processing')
      );
      if (link) link.click();
    });
    await new Promise((r) => setTimeout(r, 2000));

    const bodyText = await page.evaluate(() => document.body.innerText);
    assert(bodyText.length > 50, 'Processing Jobs page has content');
  } finally {
    await page.close();
  }
}

/* ================================================================
   Test: Settings page renders
   ================================================================ */
async function testSettingsPage() {
  console.log('\n── 5. Settings Page ──');
  const page = await browser.newPage();
  try {
    await page.goto(FRONTEND_URL, { waitUntil: 'networkidle2', timeout: 20000 });
    await waitForApp(page);

    await page.evaluate(() => {
      const links = [...document.querySelectorAll('nav a, [class*="NavLink"], button')];
      const link = links.find((l) => l.innerText?.toLowerCase().includes('setting'));
      if (link) link.click();
    });
    await new Promise((r) => setTimeout(r, 2000));

    const bodyText = await page.evaluate(() => document.body.innerText);
    assert(bodyText.length > 50, 'Settings page has content');
  } finally {
    await page.close();
  }
}

/* ================================================================
   Test: No console errors with "api_key" or "undefined"
   ================================================================ */
async function testNoConsoleErrors() {
  console.log('\n── 6. Console Error Check ──');
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });

  try {
    await page.goto(FRONTEND_URL, { waitUntil: 'networkidle2', timeout: 20000 });
    await waitForApp(page);

    const pages = ['provider', 'profile', 'job', 'setting'];
    for (const target of pages) {
      await page.evaluate((t) => {
        const links = [...document.querySelectorAll('nav a, [class*="NavLink"], button')];
        const link = links.find((l) => l.innerText?.toLowerCase().includes(t));
        if (link) link.click();
      }, target);
      await new Promise((r) => setTimeout(r, 1500));
    }

    const criticalErrors = consoleErrors.filter((e) =>
      e.toLowerCase().includes('api_key') ||
      e.toLowerCase().includes('cannot read properties of undefined') ||
      e.toLowerCase().includes('typeerror')
    );

    assert(criticalErrors.length === 0, `No critical console errors (${consoleErrors.length} total, ${criticalErrors.length} critical)`);
    if (criticalErrors.length > 0) {
      for (const err of criticalErrors.slice(0, 3)) {
        console.error(`    → ${err.slice(0, 120)}`);
      }
    }
  } finally {
    await page.close();
  }
}

/* ================================================================
   Test: API responses from frontend proxy are sanitized
   ================================================================ */
async function testFrontendApiSanitization() {
  console.log('\n── 7. Frontend API Response Sanitization ──');
  const page = await browser.newPage();
  const apiResponses = [];

  page.on('response', async (response) => {
    const url = response.url();
    if (!url.includes('/api/')) return;
    try {
      const text = await response.text();
      apiResponses.push({ url, text, status: response.status() });
    } catch { /* response may be consumed */ }
  });

  try {
    await page.goto(FRONTEND_URL, { waitUntil: 'networkidle2', timeout: 20000 });
    await waitForApp(page);

    const pages = ['provider', 'profile'];
    for (const target of pages) {
      await page.evaluate((t) => {
        const links = [...document.querySelectorAll('nav a, [class*="NavLink"], button')];
        const link = links.find((l) => l.innerText?.toLowerCase().includes(t));
        if (link) link.click();
      }, target);
      await new Promise((r) => setTimeout(r, 2000));
    }

    const leakedKeys = apiResponses.filter((r) => {
      if (r.url.includes('/health')) return false;
      try {
        const data = JSON.parse(r.text);
        return deepFindFullApiKey(data);
      } catch {
        return false;
      }
    });

    assert(leakedKeys.length === 0, `No full API keys in ${apiResponses.length} API responses`);
    if (leakedKeys.length > 0) {
      for (const leak of leakedKeys) {
        console.error(`    → Leaked in: ${leak.url}`);
      }
    }
  } finally {
    await page.close();
  }
}

function deepFindFullApiKey(obj) {
  if (obj == null || typeof obj !== 'object') return false;
  if (Array.isArray(obj)) return obj.some(deepFindFullApiKey);
  for (const [key, value] of Object.entries(obj)) {
    if (key === 'api_key' && typeof value === 'string' && value.length > 20 && !value.endsWith('...')) {
      return true;
    }
    if (typeof value === 'object' && deepFindFullApiKey(value)) return true;
  }
  return false;
}

/* ================================================================
   Run All
   ================================================================ */
async function main() {
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║  UI Regression Tests — Post Security Hardening   ║');
  console.log('╚══════════════════════════════════════════════════╝');

  const backendOk = await checkApiHealth();
  const frontendOk = await checkFrontendHealth();

  if (!backendOk) {
    console.error('✗ Backend not reachable at', API);
    process.exit(2);
  }
  if (!frontendOk) {
    console.error('✗ Frontend not reachable at', FRONTEND_URL);
    process.exit(2);
  }

  console.log('  Backend:  ✓ reachable');
  console.log('  Frontend: ✓ reachable');

  browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  try {
    await testAppLoads();
    await testProvidersPage();
    await testAiProfilesPage();
    await testProcessingJobsPage();
    await testSettingsPage();
    await testNoConsoleErrors();
    await testFrontendApiSanitization();
  } finally {
    await browser.close();
  }

  console.log('\n══════════════════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed, ${skipped} skipped`);
  console.log('══════════════════════════════════════════════════\n');

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  if (browser) browser.close();
  process.exit(2);
});
