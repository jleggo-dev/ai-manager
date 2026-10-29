/**
 * The web workspace ships to a browser and deliberately carries no `@types/node` — app code has
 * no business reaching for node APIs, and the missing types are what keeps it honest.
 *
 * A few tests need an exception: `features/food/meal/cover.contract.test.ts` reads a stylesheet
 * off disk to pin a layout contract jsdom cannot see (jsdom does no layout, and vitest is
 * configured `css: false`, so even a `?raw` import comes back empty), and
 * `styles/class-coverage.test.ts` walks src to check every class a component names has a rule.
 * These are the only node bits they use, declared narrowly here rather than by widening the
 * workspace's `types` — adding "node" there would quietly bless `process.env` in client code too.
 */
declare module 'node:fs' {
  export function existsSync(path: string): boolean;
  export function readFileSync(path: string, encoding: 'utf-8'): string;
  export function readdirSync(path: string): string[];
  export function statSync(path: string): { isDirectory(): boolean };
}
declare module 'node:path' {
  export function resolve(...parts: string[]): string;
  export function dirname(path: string): string;
  export function join(...parts: string[]): string;
  export function relative(from: string, to: string): string;
}
declare const process: { cwd(): string };
