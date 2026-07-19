/**
 * Shared structured logger for widget health-check modules.
 */

export type WhcLogFn = (
  level: 'info' | 'warn' | 'error',
  checkId: string,
  msg: string,
  extra?: Record<string, unknown>,
) => void;

export function whcLog(
  level: 'info' | 'warn' | 'error',
  checkId: string,
  msg: string,
  extra?: Record<string, unknown>,
): void {
  const entry = { component: 'widget-health-checker', checkId, msg, ...extra };
  console[level](`[widget-hc] ${JSON.stringify(entry)}`);
}
