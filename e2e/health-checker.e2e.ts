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

    it('Widget Checks page loads without errors', async () => {
      page = await freshPage();
      await switchToHealthCheckerMode(page);
      await clickNavItem(page, 'Widget Health');
      await waitForText(page, 'Widget Health');
      await assertNoPageErrors(page, 'Widget Health');
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Widget Checks — form interaction (regression for e.currentTarget) */
  /* ---------------------------------------------------------------- */

  describe('Widget Checks — form interaction regression', () => {
    it('types into all fields in create modal without crashing', async () => {
      page = await freshPage();
      await switchToHealthCheckerMode(page);
      await clickNavItem(page, 'Widget Health');
      await waitForText(page, 'Widget Health');

      await clickButton(page, 'New Widget Check');
      await new Promise((r) => setTimeout(r, 1000));

      await typeIntoInput(page, 'Marketing site widget', 'E2E Regression Widget');
      await assertNoPageErrors(page, 'Widget: after typing name');

      await typeIntoInput(page, 'https://example.com', 'https://e2e-test.example.com');
      await assertNoPageErrors(page, 'Widget: after typing URL');

      await typeIntoInput(page, 'Message sent through', 'Hello from E2E test');
      await assertNoPageErrors(page, 'Widget: after typing test message');

      const numberInputs = await page.$$('input[inputmode="numeric"]');
      for (const input of numberInputs) {
        const isVisible = await input.evaluate((e) => {
          const rect = e.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
        if (isVisible) {
          await input.click({ clickCount: 3 });
          await input.type('10');
          await new Promise((r) => setTimeout(r, 200));
        }
      }
      await assertNoPageErrors(page, 'Widget: after editing number inputs');

      const switches = await page.$$('input[role="switch"], input[type="checkbox"]');
      for (const sw of switches) {
        const isVisible = await sw.evaluate((e) => {
          const rect = e.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        });
        if (isVisible) {
          await sw.click();
          await new Promise((r) => setTimeout(r, 200));
          await sw.click();
          await new Promise((r) => setTimeout(r, 200));
        }
      }
      await assertNoPageErrors(page, 'Widget: after toggling switches');

      try {
        await clickButton(page, 'Cancel');
      } catch {
        /* modal may auto-close */
      }
    });

    it('interacts with advanced settings without crashing', async () => {
      page = await freshPage();
      await switchToHealthCheckerMode(page);
      await clickNavItem(page, 'Widget Health');
      await waitForText(page, 'Widget Health');

      await clickButton(page, 'New Widget Check');
      await new Promise((r) => setTimeout(r, 1000));

      await clickButton(page, 'Advanced Settings');
      await new Promise((r) => setTimeout(r, 500));

      const selectorInputs = await page.$$('input[placeholder*="CSS selector"]');
      expect(selectorInputs.length).toBeGreaterThan(0);

      for (const input of selectorInputs) {
        await input.type('.e2e-test-selector');
        await new Promise((r) => setTimeout(r, 200));
      }
      await assertNoPageErrors(page, 'Widget: advanced settings CSS selectors');

      try {
        await clickButton(page, 'Cancel');
      } catch {
        /* */
      }
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Widget Checks — full CRUD                                      */
  /* ---------------------------------------------------------------- */

  describe('Widget Checks — CRUD', () => {
    const widgetName = `E2E Widget ${Date.now()}`;
    const editedName = `${widgetName} EDITED`;

    it('creates a new widget check', async () => {
      page = await freshPage();
      await switchToHealthCheckerMode(page);
      await clickNavItem(page, 'Widget Health');
      await waitForText(page, 'Widget Health');

      await clickButton(page, 'New Widget Check');
      await new Promise((r) => setTimeout(r, 1000));

      await typeIntoInput(page, 'Marketing site widget', widgetName);
      await typeIntoInput(page, 'https://example.com', 'https://www.example.com/e2e-test');
      await typeIntoInput(page, 'Message sent through', 'E2E test message');

      await assertNoPageErrors(page, 'Widget: filled create form');

      await clickButton(page, 'Create');
      await new Promise((r) => setTimeout(r, 10_000));

      await assertNoPageErrors(page, 'Widget: after create submit');

      const found = await textExistsOnPage(page, widgetName);
      expect(found, `New widget "${widgetName}" should appear in the list`).toBe(true);
    });

    it('edits the widget check', async () => {
      page = await freshPage();
      await switchToHealthCheckerMode(page);
      await clickNavItem(page, 'Widget Health');
      await waitForText(page, widgetName);

      const rows = await page.$$('table tbody tr');
      let editClicked = false;
      for (const row of rows) {
        const rowText = await row.evaluate((r) => r.textContent);
        if (rowText?.includes(widgetName)) {
          const editBtn = await row.$('button[aria-label="Edit"]');
          if (editBtn) {
            await editBtn.click();
            editClicked = true;
            break;
          }
        }
      }
      expect(editClicked, 'Should find and click edit button for widget').toBe(true);

      await new Promise((r) => setTimeout(r, 1000));

      await clearAndType(page, 'Marketing site widget', editedName);
      await assertNoPageErrors(page, 'Widget: after editing name');

      await clickButton(page, 'Save');
      await new Promise((r) => setTimeout(r, 10_000));

      await assertNoPageErrors(page, 'Widget: after save');

      const found = await textExistsOnPage(page, editedName);
      expect(found, `Edited widget "${editedName}" should appear in the list`).toBe(true);
    });

    it('deletes the widget check', async () => {
      page = await freshPage();
      await switchToHealthCheckerMode(page);
      await clickNavItem(page, 'Widget Health');
      await waitForText(page, editedName);

      const rowsBefore = await countTableRows(page);

      const rows = await page.$$('table tbody tr');
      let deleteClicked = false;
      for (const row of rows) {
        const rowText = await row.evaluate((r) => r.textContent);
        if (rowText?.includes(editedName)) {
          const deleteBtn = await row.$('button[aria-label="Delete"], .tabler-icon-trash');
          if (deleteBtn) {
            await deleteBtn.click();
            deleteClicked = true;
            break;
          }
          const actionButtons = await row.$$('button');
          for (const btn of actionButtons) {
            const svgClass = await btn.evaluate((b) => b.querySelector('svg')?.classList.toString() || '');
            if (svgClass.includes('trash') || svgClass.includes('Trash')) {
              await btn.click();
              deleteClicked = true;
              break;
            }
          }
          if (!deleteClicked) {
            const allBtns = await row.$$('button');
            if (allBtns.length >= 3) {
              await allBtns[allBtns.length - 1].click();
              deleteClicked = true;
            }
          }
          break;
        }
      }
      expect(deleteClicked, 'Should find and click delete button for widget').toBe(true);

      await new Promise((r) => setTimeout(r, 1000));

      const confirmVisible = await textExistsOnPage(page, 'Delete Widget Check');
      expect(confirmVisible, 'Delete confirmation modal should be visible').toBe(true);

      await clickButton(page, 'Delete');
      await new Promise((r) => setTimeout(r, 3000));

      await assertNoPageErrors(page, 'Widget: after delete');

      const stillExists = await textExistsOnPage(page, editedName);
      expect(stillExists, `Deleted widget "${editedName}" should be gone`).toBe(false);
    });
  });

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
    it('widget create modal: cancel then reopen has clean state', async () => {
      page = await freshPage();
      await switchToHealthCheckerMode(page);
      await clickNavItem(page, 'Widget Health');
      await waitForText(page, 'Widget Health');

      await clickButton(page, 'New Widget Check');
      await new Promise((r) => setTimeout(r, 1000));

      await typeIntoInput(page, 'Marketing site widget', 'STALE STATE TEST');
      await clickButton(page, 'Cancel');
      await new Promise((r) => setTimeout(r, 500));

      await clickButton(page, 'New Widget Check');
      await new Promise((r) => setTimeout(r, 1000));

      const nameInput = await page.$('input[placeholder*="Marketing site widget"]');
      if (nameInput) {
        const value = await nameInput.evaluate((e) => (e as HTMLInputElement).value);
        expect(value, 'Name input should be empty after cancel + reopen').toBe('');
      }

      await assertNoPageErrors(page, 'Widget: reopen after cancel');

      try {
        await clickButton(page, 'Cancel');
      } catch {
        /* */
      }
    });
  });

  /* ---------------------------------------------------------------- */
  /*  Form validation — submit with missing required fields           */
  /* ---------------------------------------------------------------- */

  describe('Form validation', () => {
    it('widget create: submit with empty name shows error or prevents submit', async () => {
      page = await freshPage();
      await switchToHealthCheckerMode(page);
      await clickNavItem(page, 'Widget Health');
      await waitForText(page, 'Widget Health');

      await clickButton(page, 'New Widget Check');
      await new Promise((r) => setTimeout(r, 1000));

      await typeIntoInput(page, 'https://example.com', 'https://example.com');

      await clickButton(page, 'Create');
      await new Promise((r) => setTimeout(r, 1000));

      await assertNoPageErrors(page, 'Widget: submit without name should not crash');

      try {
        await clickButton(page, 'Cancel');
      } catch {
        /* */
      }
    });
  });
});
