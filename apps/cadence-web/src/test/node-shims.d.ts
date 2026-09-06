/**
 * The web workspace ships to a browser and deliberately carries no `@types/node` — app code has
 * no business reaching for node APIs, and the missing types are what keeps it honest.
 *
 * One test needs an exception: `features/food/meal/cover.contract.test.ts` reads a stylesheet off
 * disk to pin a layout contract jsdom cannot see (jsdom does no layout, and vitest is configured
 * `css: false`, so even a `?raw` import comes back empty). These are the only node bits it uses,
 * declared narrowly here rather than by widening the workspace's `types` — adding "node" there
 * would quietly bless `process.env` in client code too.
 */
declare module 'node:fs' {
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string, encoding: 'utf-8'): string;
}
declare module 'node:path' {
  export function resolve(...parts: string[]): string;
  export function dirname(path: string): string;
}
declare const process: { cwd(): string };
