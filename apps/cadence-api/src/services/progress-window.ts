import type { ProgressWindow } from '@cadence/shared';

/**
 * Window → sizing config for `GET /progress` and `GET /progress/history` (Progress Engine
 * parcel W1-2). One place, so the route, `buildProgress`, and the rhythm resolver never disagree
 * on what "a month" means.
 *
 * Chosen mapping (2026-08-29, documented per the parcel brief):
 *   - `week`  → 7d series / 7d consistency / 20 history rows — the week itself, nothing more.
 *   - `month` → 35d series / 35d consistency / 40 history rows — five weeks: the month plus a
 *     little runway on either side so a week straddling the 1st/last day still reads whole.
 *   - `all`   → 1825d (5y) series / 35d consistency / 80 history rows — plenty of trend history,
 *     but "consistency" still means "how you've shown up lately", not a five-year ratio nobody
 *     can act on.
 *
 * `LEGACY_CONFIG` is deliberately NOT one of the three above — it is the original, pre-window
 * behavior (90d series / 7d consistency / 40 history rows) and is what a request with NO `window`
 * query param gets, so every existing client keeps working unchanged.
 */
export interface ProgressWindowConfig {
  /** How far back the activity/weight series (and the cards derived from them) reach. */
  seriesDays: number;
  /** The trailing window `rollingConsistency` uses for "kept of scheduled". */
  consistencyDays: number;
  /** Cap on the History feed's row count. */
  historyCap: number;
}

export const LEGACY_WINDOW_CONFIG: ProgressWindowConfig = {
  seriesDays: 90,
  consistencyDays: 7,
  historyCap: 40,
};

const WINDOW_CONFIG: Record<ProgressWindow, ProgressWindowConfig> = {
  week: { seriesDays: 7, consistencyDays: 7, historyCap: 20 },
  month: { seriesDays: 35, consistencyDays: 35, historyCap: 40 },
  all: { seriesDays: 1825, consistencyDays: 35, historyCap: 80 },
};

/** `window` omitted/undefined → the legacy config (backwards compatible, see module doc). */
export function resolveWindowConfig(window?: ProgressWindow): ProgressWindowConfig {
  return window ? WINDOW_CONFIG[window] : LEGACY_WINDOW_CONFIG;
}

/** Narrow an arbitrary query-param string to a `ProgressWindow`, or `undefined` if it isn't one —
 *  never throws, so the route can treat an unrecognized value the same as "omitted". */
export function parseProgressWindow(raw: unknown): ProgressWindow | undefined {
  return raw === 'week' || raw === 'month' || raw === 'all' ? raw : undefined;
}
