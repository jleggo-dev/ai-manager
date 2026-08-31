import { useQuery } from '@tanstack/react-query';
import type { MealKind, ProgressWindow, SessionFeedbackKind } from '@cadence/shared';
import {
  getProgressEvents,
  getProgressBalance,
  getProgressTotals,
  getProgressVariety,
  getProgressStagePath,
  getProgressCount,
  getProgressRepertoire,
  getProgressFeltWeeks,
  getProgressThenNow,
} from '../api.ts';
import { queryKeys } from './keys.ts';

/** `shelf` — bests & firsts in [from, to]. */
export function useProgressEvents(from: string, to: string) {
  return useQuery({ queryKey: queryKeys.progressExtras.events(from, to), queryFn: () => getProgressEvents(from, to) });
}

/** `balance` — felt-state proportion for one feedback kind + window. */
export function useProgressBalance(kind: SessionFeedbackKind, window: ProgressWindow) {
  return useQuery({
    queryKey: queryKeys.progressExtras.balance(kind, window),
    queryFn: () => getProgressBalance(kind, window),
  });
}

/** `total` — presence for one goal + window. */
export function useProgressTotals(goalId: string, window: ProgressWindow) {
  return useQuery({
    queryKey: queryKeys.progressExtras.totals(goalId, window),
    queryFn: () => getProgressTotals(goalId, window),
    enabled: Boolean(goalId),
  });
}

/** `variety` — distinct foods for a window × meal slice. */
export function useProgressVariety(window: ProgressWindow, meal?: MealKind) {
  return useQuery({
    queryKey: queryKeys.progressExtras.variety(window, meal),
    queryFn: () => getProgressVariety(window, meal),
  });
}

/** `stage_path` — stage chips for one goal. */
export function useProgressStagePath(goalId: string) {
  return useQuery({
    queryKey: queryKeys.progressExtras.stagePath(goalId),
    queryFn: () => getProgressStagePath(goalId),
    enabled: Boolean(goalId),
  });
}

/** `count_toward` — n of target for one goal. */
export function useProgressCount(goalId: string) {
  return useQuery({
    queryKey: queryKeys.progressExtras.count(goalId),
    queryFn: () => getProgressCount(goalId),
    enabled: Boolean(goalId),
  });
}

/** `repertoire` — what they're learning or already have; no goalId means everything they keep. */
export function useProgressRepertoire(goalId?: string) {
  return useQuery({
    queryKey: queryKeys.progressExtras.repertoire(goalId ?? ''),
    queryFn: () => getProgressRepertoire(goalId),
  });
}

/** `felt_week` — the last four weeks colored by daily check-in mood. */
export function useProgressFeltWeeks() {
  return useQuery({ queryKey: queryKeys.progressExtras.feltWeeks, queryFn: getProgressFeltWeeks });
}

/** `then_now` — plain before/after pairs since the start. */
export function useProgressThenNow() {
  return useQuery({ queryKey: queryKeys.progressExtras.thenNow, queryFn: getProgressThenNow });
}
