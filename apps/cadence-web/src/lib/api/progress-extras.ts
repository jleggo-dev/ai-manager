/**
 * Non-temporal Progress Engine reads (docs/cadence/PROGRESS-ENGINE.md W1-5) — client for
 * routes/progress-extras.ts. Plumbing only: no screens, no ProgressView wiring (that's W1-6).
 *
 * Each read can come back as either the widget's payload or `{ omission }` — the server never
 * throws or goes silent when a section has nothing to bind, so the client doesn't either.
 */
import type {
  BalancePayload,
  CountTowardPayload,
  MealKind,
  ProgressWindow,
  SessionFeedbackKind,
  ShelfPayload,
  StagePathPayload,
  TotalPayload,
  VarietyPayload,
  WidgetOmission,
} from '@cadence/shared';
import { BASE, headers } from './http.ts';

export type Omittable<T> = T | { omission: WidgetOmission };

async function getExtra<T>(path: string): Promise<Omittable<T>> {
  const res = await fetch(`${BASE}${path}`, { headers: headers() });
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return res.json();
}

/** `shelf` — bests & firsts from goal_events in [from, to] (both YYYY-MM-DD). */
export async function getProgressEvents(from: string, to: string): Promise<Omittable<ShelfPayload>> {
  return getExtra(`/progress/events?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);
}

/** `balance` — felt-state proportion from session_feedback. */
export async function getProgressBalance(
  kind: SessionFeedbackKind,
  window: ProgressWindow,
): Promise<Omittable<BalancePayload>> {
  return getExtra(`/progress/balance?kind=${kind}&window=${window}`);
}

/** `total` — presence from counted log units, scoped to one goal. */
export async function getProgressTotals(goalId: string, window: ProgressWindow): Promise<Omittable<TotalPayload>> {
  return getExtra(`/progress/totals?goal_id=${encodeURIComponent(goalId)}&window=${window}`);
}

/** `variety` — distinct foods for a (window × meal) slice; meal defaults server-side to 'dinner'. */
export async function getProgressVariety(window: ProgressWindow, meal?: MealKind): Promise<Omittable<VarietyPayload>> {
  const mealParam = meal ? `&meal=${meal}` : '';
  return getExtra(`/progress/variety?window=${window}${mealParam}`);
}

/** `stage_path` — stage chips from a goal's milestones/stepping-stones. */
export async function getProgressStagePath(goalId: string): Promise<Omittable<StagePathPayload>> {
  return getExtra(`/progress/stage-path?goal_id=${encodeURIComponent(goalId)}`);
}

/** `count_toward` — n of target from a count-measure goal. */
export async function getProgressCount(goalId: string): Promise<Omittable<CountTowardPayload>> {
  return getExtra(`/progress/count?goal_id=${encodeURIComponent(goalId)}`);
}
