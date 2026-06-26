/**
 * Browser launcher – abstracts Puppeteer/Chromium across environments.
 *
 * Serverless (Vercel / Lambda): uses @sparticuz/chromium which ships a
 * stripped-down Chromium binary that fits within function size limits.
 *
 * Local / CI: falls back to the full `puppeteer` (devDependency) which
 * manages its own Chromium download.
 */

import puppeteerCore from 'puppeteer-core';
import type { Browser } from 'puppeteer-core';

type LaunchOptions = NonNullable<Parameters<typeof puppeteerCore.launch>[0]>;

const isServerless = !!(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);

let resolvedSource = 'none';
let resolvedPath = '';
let lastProbeError = '';

/**
 * Resolve the Chromium executable path and base launch args.
 * In serverless environments, @sparticuz/chromium provides both.
 * Locally, puppeteer's bundled browser is used via its known cache path.
 */
async function resolveChromium(): Promise<{ executablePath: string; args: string[] }> {
  if (process.env.CHROME_PATH) {
    resolvedSource = 'CHROME_PATH env';
    resolvedPath = process.env.CHROME_PATH;
    console.log(`[browser] Using CHROME_PATH override: ${resolvedPath}`);
    return { executablePath: process.env.CHROME_PATH, args: [] };
  }

  if (isServerless) {
    console.log('[browser] Serverless detected (VERCEL/Lambda), using @sparticuz/chromium');
    try {
      const chromium = (await import('@sparticuz/chromium')).default;
      chromium.setGraphicsMode = false;
      const executablePath = await chromium.executablePath();
      resolvedSource = '@sparticuz/chromium';
      resolvedPath = executablePath;
      console.log(`[browser] @sparticuz/chromium resolved to: ${executablePath}`);
      return { executablePath, args: chromium.args };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`[browser] @sparticuz/chromium failed: ${msg}`);
      resolvedSource = '@sparticuz/chromium (FAILED)';
      lastProbeError = msg;
      throw new Error(`@sparticuz/chromium failed to resolve executable: ${msg}`, { cause: err });
    }
  }

  try {
    const puppeteerFull = (await import('puppeteer')).default;
    const execPath = puppeteerFull.executablePath();
    resolvedSource = 'puppeteer (dev)';
    resolvedPath = execPath;
    console.log(`[browser] Using puppeteer bundled browser: ${execPath}`);
    return { executablePath: execPath, args: [] };
  } catch {
    /* puppeteer not installed (production) — fall through to common locations */
  }

  const commonPaths = [
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];

  for (const p of commonPaths) {
    try {
      const { execSync } = await import('child_process');
      execSync(`test -f "${p}"`, { stdio: 'ignore' });
      resolvedSource = `system (${p})`;
      resolvedPath = p;
      console.log(`[browser] Found system Chrome at: ${p}`);
      return { executablePath: p, args: [] };
    } catch {
      continue;
    }
  }

  resolvedSource = 'none (FAILED)';
  throw new Error('Could not locate a Chromium/Chrome executable. Set CHROME_PATH or install puppeteer.');
}

let cachedChromiumConfig: { executablePath: string; args: string[] } | null = null;

async function getChromiumConfig(): Promise<{ executablePath: string; args: string[] }> {
  if (!cachedChromiumConfig) {
    cachedChromiumConfig = await resolveChromium();
  }
  return cachedChromiumConfig;
}

/**
 * Launch a headless browser appropriate for the current environment.
 * Merges caller-provided options with environment-specific defaults.
 */
export async function launchBrowser(overrides: Partial<LaunchOptions> = {}): Promise<Browser> {
  const { executablePath, args: envArgs } = await getChromiumConfig();

  const defaultArgs = [
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--disable-extensions',
    '--disable-background-networking',
    '--no-first-run',
    ...envArgs,
  ];

  const mergedArgs = Array.from(new Set([...defaultArgs, ...(overrides.args ?? [])]));

  return puppeteerCore.launch({
    ...overrides,
    headless: true,
    executablePath,
    args: mergedArgs,
    timeout: overrides.timeout ?? 90_000,
  });
}

/**
 * Quick probe — launches and immediately closes a browser to verify
 * that Chromium is accessible. Returns true on success, false on failure.
 */
export async function probeBrowserAvailability(): Promise<boolean> {
  try {
    const browser = await launchBrowser({ timeout: 30_000 });
    await browser.close();
    lastProbeError = '';
    return true;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    lastProbeError = msg;
    console.warn('[browser] Chromium probe failed:', msg);
    return false;
  }
}

/**
 * Diagnostics — reports the current Chromium resolution state for debugging
 * deployment issues. Exposed via GET /api/health/chromium.
 */
export function getBrowserDiagnostics(): Record<string, unknown> {
  return {
    isServerless,
    resolvedSource,
    resolvedPath,
    lastProbeError: lastProbeError || null,
    envVars: {
      VERCEL: process.env.VERCEL ?? '(not set)',
      AWS_LAMBDA_FUNCTION_NAME: process.env.AWS_LAMBDA_FUNCTION_NAME ?? '(not set)',
      CHROME_PATH: process.env.CHROME_PATH ?? '(not set)',
      NODE_ENV: process.env.NODE_ENV ?? '(not set)',
    },
    puppeteerCoreVersion: puppeteerCore.executablePath?.() ?? 'N/A',
    cached: cachedChromiumConfig !== null,
  };
}
