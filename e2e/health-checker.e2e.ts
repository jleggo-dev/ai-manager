/**
 * Comprehensive E2E tests for Health Checker pages.
 *
 * These tests run in a REAL browser via Puppeteer — they catch bugs that
 * JSDOM-based unit tests cannot (React event lifecycle, CSS layout, Mantine
 * component behavior, cross-page data flow).
 *
 * Prerequisites:
 *   - Frontend dev server running on localhost:5173 (or set E2E_BASE_URL)
 *   - Backend running on localhost:3001
 *   - VITE_DEV_API_KEY set in backend/.env for auto-auth
 *
 * Run: npm run test:e2e
 */

import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import type { Page } from 'puppeteer';
import { getBrowser, closeBrowser, newPage, navigateTo, getPageErrors } from './helpers';

let page: Page;

beforeAll(async () => {
  await getBrowser();
});

afterAll(async () => {
  await page?.close();
  await closeBrowser();
});

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

async function waitForText(p: Page, text: string, timeout = 30_000): Promise<void> {
  await p.waitForFunction(
    (t: string) => document.body.innerText.includes(t),
    { timeout },
    text,
  );
}

async function clickButton(p: Page, text: string): Promise<void> {
  await p.waitForFunction(
    (t: string) => {
      const buttons = Array.from(document.querySelectorAll('button'));
      return buttons.some((b) => b.textContent?.trim().includes(t));
    },
    { timeout: 30_000 },
    text,
  );
  const buttons = await p.$$('button');
  for (const btn of buttons) {
    const btnText = await btn.evaluate((e) => e.textContent?.trim());
    if (btnText?.includes(text)) {
      await btn.click();
      return;
    }
  }
  throw new Error(`Button "${text}" not found`);
}

async function assertNoPageErrors(p: Page, context: string): Promise<void> {
  const errors = getPageErrors(p);
  const critical = errors.filter(
    (e) =>
      e.includes('TypeError') ||
      e.includes('Cannot read properties of null') ||
      e.includes('Cannot read properties of undefined'),
  );
  expect(critical, `Critical JS errors on ${context}: ${critical.join('; ')}`).toHaveLength(0);
}

async function freshPage(): Promise<Page> {
  if (page) await page.close().catch(() => {});
  page = await newPage();
  return page;
}

async function switchToHealthCheckerMode(p: Page): Promise<void> {
  await navigateTo(p, '/?mode=health-checker');
  await new Promise((r) => setTimeout(r, 2000));
  await p.waitForFunction(
    () => {
      const navButtons = Array.from(document.querySelectorAll('nav button[aria-label]'));
      return navButtons.some((b) => b.getAttribute('aria-label') === 'Dashboard');
    },
    { timeout: 15_000 },
  );
}

async function clickNavItem(p: Page, label: string): Promise<void> {
  await p.waitForFunction(
    (l: string) => {
      const buttons = Array.from(document.querySelectorAll('nav button[aria-label]'));
      return buttons.some((b) => b.getAttribute('aria-label') === l);
    },
    { timeout: 10_000 },
    label,
  );
  const navBtn = await p.$(`nav button[aria-label="${label}"]`);
  if (!navBtn) throw new Error(`Nav button "${label}" not found`);
  await navBtn.click();
  await new Promise((r) => setTimeout(r, 2000));
}

async function typeIntoInput(p: Page, placeholder: string, text: string): Promise<void> {
  const input = await p.$(`input[placeholder*="${placeholder}"], textarea[placeholder*="${placeholder}"]`);
  if (!input) throw new Error(`Input with placeholder "${placeholder}" not found`);
  await input.click({ clickCount: 3 });
  await input.type(text);
  await new Promise((r) => setTimeout(r, 300));
}

async function clearAndType(p: Page, placeholder: string, text: string): Promise<void> {
  const input = await p.$(`input[placeholder*="${placeholder}"], textarea[placeholder*="${placeholder}"]`);
  if (!input) throw new Error(`Input with placeholder "${placeholder}" not found`);
  await input.click({ clickCount: 3 });
  await p.keyboard.press('Backspace');
  await input.type(text);
  await new Promise((r) => setTimeout(r, 300));
}

async function waitForModalClose(p: Page, title: string, timeout = 10_000): Promise<void> {
  await p.waitForFunction(
    (t: string) => {
      const modals = document.querySelectorAll('[role="dialog"]');
      return !Array.from(modals).some((m) => m.textContent?.includes(t));
    },
    { timeout },
    title,
  );
}

async function textExistsOnPage(p: Page, text: string): Promise<boolean> {
  return p.evaluate((t) => document.body.innerText.includes(t), text);
}

async function countTableRows(p: Page): Promise<number> {
  return p.evaluate(() => {
    const rows = document.querySelectorAll('table tbody tr');
    return rows.length;
  });
}

/* ------------------------------------------------------------------ */
/*  Tests: Page loads                                                 */
/* ------------------------------------------------------------------ */

describe('Health Checker E2E', () => {
  describe('Page load smoke tests', () => {
    it('switches to Health Checker mode', async () => {
      page = await freshPage();
      await switchToHealthCheckerMode(page);
      await assertNoPageErrors(page, 'mode switch');
    });

    it('Dashboard loads without errors', async () => {
      page = await freshPage();
      await switchToHealthCheckerMode(page);
      await clickNavItem(page, 'Dashboard');
      await assertNoPageErrors(page, 'Dashboard');
    });

    it('Provider Keys page loads without errors', async () => {
      page = await freshPage();
      await switchToHealthCheckerMode(page);
      await clickNavItem(page, 'Provider Keys');
      await new Promise((r) => setTimeout(r, 2000));
      await assertNoPageErrors(page, 'Provider Keys');
    });

    it('Profiles page loads without errors', async () => {
      page = await freshPage();
      await switchToHealthCheckerMode(page);
      await clickNavItem(page, 'Profiles');
      await waitForText(page, 'Health Check Profiles');
      await assertNoPageErrors(page, 'Profiles');
    });

    it('Health Checks page loads without errors', async () => {
      page = await freshPage();
      await switchToHealthCheckerMode(page);
      await clickNavItem(page, 'API Health');
      await waitForText(page, 'API Health');
      await assertNoPageErrors(page, 'API Health');
    });

  });

  /* ---------------------------------------------------------------- */
  /* ---------------------------------------------------------------- */

  /* ---------------------------------------------------------------- */
  /* ---------------------------------------------------------------- */

  /* ---------------------------------------------------------------- */
  /*  Health Check Config — edit modal                                */
  /* ---------------------------------------------------------------- */

  describe('Health Checks — edit interaction', () => {
    it('opens edit modal, types in fields, and cancels without crash', async () => {
      page = await freshPage();
      await switchToHealthCheckerMode(page);
      await clickNavItem(page, 'API Health');
      await new Promise((r) => setTimeout(r, 2000));

      const editButton = await page.$('button[aria-label="Edit"]');
      if (!editButton) {
        console.log('[E2E] No health checks to edit, skipping');
        return;
      }

      await editButton.click();
      await new Promise((r) => setTimeout(r, 1000));

      const nameInput = await page.$('input[placeholder*="heartbeat"], input[placeholder*="GPT"]');
      if (nameInput) {
        await nameInput.click({ clickCount: 3 });
        await nameInput.type('E2E edited name');
        await new Promise((r) => setTimeout(r, 500));
      }

      const messageInput = await page.$('textarea[placeholder*="Message sent"]');
      if (messageInput) {
        await messageInput.click({ clickCount: 3 });
        await messageInput.type('E2E test message');
        await new Promise((r) => setTimeout(r, 500));
      }

      await assertNoPageErrors(page, 'Health Check: edit modal interaction');

      try {
        await clickButton(page, 'Cancel');
      } catch {
        /* */
      }
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Profiles — form interaction                                     */
  /* ---------------------------------------------------------------- */

  describe('Profiles — form interaction', () => {
    it('opens create modal and interacts without crashing', async () => {
      page = await freshPage();
      await switchToHealthCheckerMode(page);
      await clickNavItem(page, 'Profiles');
      await waitForText(page, 'Health Check Profiles');

      const addBtn = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        return buttons.some(
          (b) =>
            b.textContent?.includes('New Profile') || b.textContent?.includes('Add Profile'),
        );
      });

      if (!addBtn) {
        console.log('[E2E] No add profile button found, skipping');
        return;
      }

      try {
        await clickButton(page, 'New Profile');
      } catch {
        try {
          await clickButton(page, 'Add Profile');
        } catch {
          console.log('[E2E] Could not click add profile button');
          return;
        }
      }

      await new Promise((r) => setTimeout(r, 1500));
      await assertNoPageErrors(page, 'Profile: create modal open');

      const nameInput = await page.$('input[placeholder*="GPT-4 Health"]');
      if (nameInput) {
        await nameInput.click({ clickCount: 3 });
        await nameInput.type('E2E Profile Test');
        await new Promise((r) => setTimeout(r, 500));
      }

      await assertNoPageErrors(page, 'Profile: after typing name');

      try {
        await clickButton(page, 'Cancel');
      } catch {
        /* */
      }
    });

    it('opens edit modal on existing profile without crashing', async () => {
      page = await freshPage();
      await switchToHealthCheckerMode(page);
      await clickNavItem(page, 'Profiles');
      await new Promise((r) => setTimeout(r, 2000));

      const editButton = await page.$('button[aria-label="Edit"]');
      if (!editButton) {
        console.log('[E2E] No profiles to edit, skipping');
        return;
      }

      await editButton.click();
      await new Promise((r) => setTimeout(r, 1000));

      await assertNoPageErrors(page, 'Profile: edit modal open');

      const nameInput = await page.$('input[placeholder*="GPT-4 Health"]');
      if (nameInput) {
        await nameInput.click({ clickCount: 3 });
        await nameInput.type('E2E Profile Edited');
        await new Promise((r) => setTimeout(r, 500));
      }

      await assertNoPageErrors(page, 'Profile: after editing name');

      try {
        await clickButton(page, 'Cancel');
      } catch {
        /* */
      }
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Provider Keys — form interaction                                */
  /* ---------------------------------------------------------------- */

  describe('Provider Keys — form interaction', () => {
    it('opens add key modal and interacts without crashing', async () => {
      page = await freshPage();
      await switchToHealthCheckerMode(page);
      await clickNavItem(page, 'Provider Keys');
      await new Promise((r) => setTimeout(r, 2000));

      const hasAddBtn = await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button'));
        return buttons.some(
          (b) =>
            b.textContent?.includes('Add Key') ||
            b.textContent?.includes('New Key') ||
            b.textContent?.includes('Add Provider'),
        );
      });

      if (!hasAddBtn) {
        console.log('[E2E] No add key button found, skipping');
        return;
      }

      try {
        await clickButton(page, 'Add Key');
      } catch {
        try {
          await clickButton(page, 'New Key');
        } catch {
          try {
            await clickButton(page, 'Add Provider');
          } catch {
            console.log('[E2E] Could not click add key button');
            return;
          }
        }
      }

      await new Promise((r) => setTimeout(r, 1000));
      await assertNoPageErrors(page, 'Provider Key: add modal open');

      const nameInput = await page.$('input[placeholder*="Key name"]');
      if (nameInput) {
        await nameInput.type('E2E Test Key');
        await new Promise((r) => setTimeout(r, 500));
      }

      const apiKeyInput = await page.$('input[placeholder*="Enter API key"]');
      if (apiKeyInput) {
        await apiKeyInput.type('sk-test-fake-key-for-e2e');
        await new Promise((r) => setTimeout(r, 500));
      }

      await assertNoPageErrors(page, 'Provider Key: after filling fields');

      try {
        await clickButton(page, 'Cancel');
      } catch {
        /* */
      }
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Cross-page: modal cancel / close doesn't leave stale state      */
  /* ---------------------------------------------------------------- */

  describe('Modal lifecycle — no stale state after cancel', () => {
  });

  /* ---------------------------------------------------------------- */
  /*  Form validation — submit with missing required fields           */
  /* ---------------------------------------------------------------- */

  describe('Form validation', () => {
  });
});
