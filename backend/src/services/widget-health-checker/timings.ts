/**
 * Timing constants for widget health checks.
 * Override via env for unit tests (production defaults unchanged).
 */

function envMs(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export const HARD_TIMEOUT_BUFFER_MS = envMs('WIDGET_HC_HARD_TIMEOUT_BUFFER_MS', 30_000);
export const SETTLE_DELAY_MS = envMs('WIDGET_HC_SETTLE_MS', 3_000);
export const STABILITY_CHECK_MS = envMs('WIDGET_HC_STABILITY_CHECK_MS', 500);
export const STABILITY_THRESHOLD = 3;
export const POST_ENTER_DELAY_MS = envMs('WIDGET_HC_POST_ENTER_MS', 2_000);
export const TRANSIENT_RETRY_BASE_MS = envMs('WIDGET_HC_TRANSIENT_RETRY_BASE_MS', 3_000);
export const ATTEMPT_RETRY_BASE_MS = envMs('WIDGET_HC_ATTEMPT_RETRY_BASE_MS', 2_000);
