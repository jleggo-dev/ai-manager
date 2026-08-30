/**
 * Small shared helpers for the Progress Engine's non-temporal resolvers (W1-5):
 * turning the page's `ProgressWindow` control into a concrete date range + label, and the
 * evidence shape guards report when a section has nothing to bind (never a throw, never a
 * silent null — docs/cadence/PROGRESS-ENGINE.md "Rendering contract").
 */
import type { ProgressWindow, WidgetKind, WidgetOmission } from '@cadence/shared';

/** Before any real user data — a floor for `window=all` so a single from/to query still works. */
export const EPOCH_DATE = '1970-01-01';

export interface WindowRange {
  /** YYYY-MM-DD, inclusive. Always `EPOCH_DATE` for 'all' so callers never branch on null. */
  from: string;
  /** YYYY-MM-DD, inclusive — today. */
  to: string;
  /** Plain window phrase for a payload's `window_label` ('this week', 'this month', 'all time'). */
  label: string;
  /** The same window expressed as a trailing day count, for callers keyed on days (practice totals). */
  days: number;
}

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Deterministic window → date range. 'week'/'month' are trailing windows ending today, not
 *  calendar-aligned — the same rolling-window stance `rollingConsistency` takes elsewhere. */
export function resolveWindowRange(window: ProgressWindow, now: Date = new Date()): WindowRange {
  const to = iso(now.getTime());
  if (window === 'week') return { from: iso(now.getTime() - 6 * 86_400_000), to, label: 'this week', days: 7 };
  if (window === 'month') return { from: iso(now.getTime() - 29 * 86_400_000), to, label: 'this month', days: 30 };
  return { from: EPOCH_DATE, to, label: 'all time', days: 365 };
}

/** Guards report evidence: an unbindable section is a WidgetOmission, never a thrown error or a
 *  silent null. */
export function omit(id: string, kind: WidgetKind, reason: string): WidgetOmission {
  return { id, kind, reason };
}
