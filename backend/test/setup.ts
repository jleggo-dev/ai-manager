import 'dotenv/config';
import app from '../src/app.ts';

export { app };

const API_KEY = process.env.VITE_DEV_API_KEY || process.env.TEST_API_KEY || '';
if (!API_KEY) {
  throw new Error(
    'No API key found. Set VITE_DEV_API_KEY or TEST_API_KEY in .env (CI sets TEST_API_KEY automatically)',
  );
}

export function authHeaders(): Record<string, string> {
  return { Authorization: `Bearer ${API_KEY}` };
}

export function uniqueName(prefix: string): string {
  return `${prefix} ${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

export function uniqueSlug(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

const cleanupFns: Array<() => Promise<void>> = [];

export function onCleanup(fn: () => Promise<void>): void {
  cleanupFns.push(fn);
}

export async function runCleanup(): Promise<void> {
  for (const fn of cleanupFns.reverse()) {
    try {
      await fn();
    } catch {
      // best-effort cleanup
    }
  }
  cleanupFns.length = 0;
}
