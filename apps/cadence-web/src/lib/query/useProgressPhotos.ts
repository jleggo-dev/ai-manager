import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getProgressPhotoPair,
  getProgressPhotos,
  getProgressPhotosStatus,
  postProgressPhoto,
  putProgressPhotosEnabled,
  type ProgressPhotosStatus,
} from '../api.ts';
import { queryKeys } from './keys.ts';

/** `photo_pair` — the earliest and latest progress photos (opt-in; omission when off or empty). */
export function useProgressPhotoPair() {
  return useQuery({ queryKey: queryKeys.progressPhotos.pair, queryFn: getProgressPhotoPair });
}

/** `/progress/photos` — every photo, oldest first, plus opt-in state / count / next-due. The
 *  "All photos" screen's (SR-5) one read. Off comes back honest and empty, never an error. */
export function useProgressPhotos() {
  return useQuery({ queryKey: queryKeys.progressPhotos.all, queryFn: getProgressPhotos });
}

/**
 * Just the opt-in state, count and next-due — the Settings toggle and the quick-add row, neither of
 * which wants the signed URL of every photo in order to draw itself. Cached so those two render
 * with the screen around them instead of appearing a round trip into it.
 */
export function useProgressPhotosStatus() {
  return useQuery<ProgressPhotosStatus>({
    queryKey: queryKeys.progressPhotos.status,
    queryFn: getProgressPhotosStatus,
    staleTime: 5 * 60_000,
  });
}

/** Flip the cached opt-in state after a toggle, so both readers of it agree immediately. */
export function useSetProgressPhotosStatus() {
  const queryClient = useQueryClient();
  return (enabled: boolean) =>
    queryClient.setQueryData<ProgressPhotosStatus>(queryKeys.progressPhotos.status, (prev) =>
      prev ? { ...prev, enabled } : prev,
    );
}

/** Invalidate both photo reads — the pair card and the full list agree on the same facts, so an
 *  upload or an enable/disable must refresh whichever of the two is on screen. */
function invalidatePhotoReads(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: queryKeys.progressPhotos.all });
  void queryClient.invalidateQueries({ queryKey: queryKeys.progressPhotos.pair });
  void queryClient.invalidateQueries({ queryKey: queryKeys.progressPhotos.status });
}

/**
 * Store a new progress photo. Resolves to the stored `{ photo, next_due }`, or `null` on failure
 * (off, invalid photo, or a network/server hiccup) — same no-optimistic-update discipline as
 * `useSaveNotificationPrefs`: the grid only shows a photo once the server actually has it.
 */
export function useUploadProgressPhoto() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { photo: string; takenOn?: string }) => postProgressPhoto(input.photo, input.takenOn),
    onSuccess: (stored) => {
      if (stored) invalidatePhotoReads(queryClient);
    },
  });
}

/** The opt-in switch (routes/progress-photos.ts PUT /photos/enabled). Not wired to any UI in this
 *  parcel — the settings row that flips it lives elsewhere — but both reads it can change agree
 *  once it lands, so it invalidates the same pair. */
export function useSetProgressPhotosEnabled() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) => putProgressPhotosEnabled(enabled),
    onSuccess: (result) => {
      if (result) invalidatePhotoReads(queryClient);
    },
  });
}
