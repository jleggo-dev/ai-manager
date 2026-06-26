import puppeteer, { type Browser, type Page } from 'puppeteer';

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5173';

let browser: Browser | null = null;

export async function getBrowser(): Promise<Browser> {
  if (!browser) {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
    });
  }
  return browser;
}

export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
  }
}

export async function newPage(): Promise<Page> {
  const b = await getBrowser();
  const page = await b.newPage();
  page.setDefaultTimeout(60_000);
  page.setDefaultNavigationTimeout(60_000);

  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(err.message));
  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      errors.push(msg.text());
    }
  });
  (page as Page & { _e2eErrors: string[] })._e2eErrors = errors;

  return page;
}

export function getPageErrors(page: Page): string[] {
  return (page as Page & { _e2eErrors: string[] })._e2eErrors || [];
}

export async function navigateTo(page: Page, path: string): Promise<void> {
  await page.goto(`${BASE_URL}${path}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await new Promise((r) => setTimeout(r, 1000));
}

export async function waitForSelector(page: Page, selector: string, timeout = 30_000): Promise<void> {
  await page.waitForSelector(selector, { timeout });
}

export async function clickNavItem(page: Page, label: string): Promise<void> {
  const nav = await page.$$('nav a, [data-testid="nav-link"]');
  for (const el of nav) {
    const text = await el.evaluate((e) => e.textContent?.trim());
    if (text === label) {
      await el.click();
      await page.waitForNavigation({ waitUntil: 'networkidle2' }).catch(() => {});
      await new Promise((r) => setTimeout(r, 500));
      return;
    }
  }
  throw new Error(`Nav item "${label}" not found`);
}

export { BASE_URL };
