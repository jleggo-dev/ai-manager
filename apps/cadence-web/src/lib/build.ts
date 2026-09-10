/**
 * Which build this is — the short commit it was built from, and the day.
 *
 * Stamped by Vite at build time (`__CADENCE_BUILD__`, vite.config.ts) and shown at the foot of
 * Settings. It exists because "the phone is on an older bundle" and "the fix is broken" look
 * identical from the outside, and on 2026-09-09 the only way to tell them apart was to tap a
 * control and reason about what it did. Vitest does not run the app's Vite config, and neither
 * does anything that imports this module outside a build — hence the guard.
 */
declare const __CADENCE_BUILD__: string | undefined;

export function buildStamp(): string {
  return typeof __CADENCE_BUILD__ === 'string' && __CADENCE_BUILD__ ? __CADENCE_BUILD__ : 'dev';
}
