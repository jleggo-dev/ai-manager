import type { CheckUptimeHistory, UptimeTotals } from '../types/api';

const EMPTY_TOTALS: UptimeTotals = {
  pass: 0,
  fail: 0,
  timeout: 0,
  error: 0,
  warning: 0,
};

/** Sum pass/fail/timeout/error/warning across API + widget check histories. */
export function aggregateUptimeTotals(history: CheckUptimeHistory[]): UptimeTotals {
  return history.reduce(
    (acc, h) => ({
      pass: acc.pass + h.totals.pass,
      fail: acc.fail + h.totals.fail,
      timeout: acc.timeout + h.totals.timeout,
      error: acc.error + h.totals.error,
      warning: acc.warning + (h.totals.warning ?? 0),
    }),
    { ...EMPTY_TOTALS },
  );
}

/**
 * Lowest uptime first so the weakest checks surface at the top of the graph view.
 * Null uptime sorts after every numeric value (treated as 101%).
 */
export function sortHistoryByUptimeAsc(history: CheckUptimeHistory[]): CheckUptimeHistory[] {
  return [...history].sort((a, b) => (a.uptimePercent ?? 101) - (b.uptimePercent ?? 101));
}

/** Count dashboard items that currently have an open incident. */
export function countActiveIncidents(items: ReadonlyArray<{ activeIncident: unknown }>): number {
  return items.filter((i) => Boolean(i.activeIncident)).length;
}

/**
 * Overall uptime as a percentage of decisive runs (pass / pass+fail+timeout+error).
 * Warnings are excluded from the denominator to match the dashboard banner.
 * Returns null when there are no decisive runs.
 */
export function overallUptimePercent(totals: UptimeTotals): number | null {
  const total = totals.pass + totals.fail + totals.timeout + totals.error;
  if (total === 0) return null;
  return Math.round((totals.pass / total) * 10_000) / 100;
}

/** Display string for the Overall Uptime banner (`N/A` or `99.50%`). */
export function formatOverallUptimePercent(totals: UptimeTotals): string {
  const pct = overallUptimePercent(totals);
  return pct == null ? 'N/A' : `${pct.toFixed(2)}%`;
}
