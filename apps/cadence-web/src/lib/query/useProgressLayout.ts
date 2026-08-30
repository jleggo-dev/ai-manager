import { useQuery } from '@tanstack/react-query';
import type { ProgressLayout } from '@cadence/shared';
import { getProgressLayout, getProgressLayoutDraft, type ProgressLayoutDraft } from '../api.ts';
import { queryKeys } from './keys.ts';

/**
 * The `/me/progress-layout` query — same shared-cache shape as usePlan/useProgress (PERF-01): a
 * tab return paints from cache instantly while revalidating in the background. Integration (W1-6)
 * wires this into ProgressView to drive section order/kinds from the layout instead of a fixed page.
 */
export function useProgressLayout() {
  return useQuery<ProgressLayout>({ queryKey: queryKeys.progressLayout.all, queryFn: getProgressLayout });
}

/**
 * The progress talk's pending draft (Wave 3, W3-2) — LayoutProposalCard's read.
 *
 * Plain `useQuery`, no options beyond queryKey/queryFn: same "no extra polling interval" cadence
 * WeekReviewCard/ChangeCard's own fetch-on-mount already have (they carry no interval either), and
 * the same enabled-scoping — this only ever runs where the card mounts (beside the last finished
 * chat turn), never as a background poll the whole app pays for. No custom staleTime either,
 * because a stale draft the coach revised a moment ago must never paint as the old one.
 */
export function useProgressLayoutDraft() {
  return useQuery<ProgressLayoutDraft | null>({
    queryKey: queryKeys.progressLayout.draft,
    queryFn: getProgressLayoutDraft,
    staleTime: 0,
  });
}
