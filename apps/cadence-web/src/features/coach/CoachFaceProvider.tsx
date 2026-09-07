import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { CoachFaceId } from '@cadence/shared';
import { getCoachFace, setCoachFace } from '../../lib/api.ts';
import { queryKeys } from '../../lib/query/keys.ts';
import { CoachFaceContext, resolveFace, type CoachFaceState } from './coachFaceContext.ts';

/** What the cache holds for her face — an object, so a stored null pick is not "nothing cached". */
export interface CoachFaceCacheEntry {
  face_id: CoachFaceId | null;
}

/**
 * Loads the picked portrait once for the signed-in app and keeps every surface in step.
 *
 * `authReady` gates the read. The paint-before-auth boot (#311) mounts this provider before the
 * bearer token exists, and a read fired then is a guaranteed 401 — which the old code recorded as
 * "hasn't picked" and never retried (its effect ran once, and the app's early and ready branches
 * render the same element so the instance survives the auth flip). That is the whole story of the
 * portrait "reverting" to the mark on cold launches. The effect is keyed on `authReady` so the
 * flip re-runs it, and a failed read leaves `ready` false — `useEnsureCoachFace` refuses to draw
 * until a read has genuinely answered, so a blip can no longer be papered over with a random
 * portrait PUT over the user's real pick.
 *
 * **Painted from disk since 2026-09-07.** The pick is seeded from the query cache — which the boot
 * snapshot fills before React's first render — and every settled read or pick is written back
 * into it. The header used to show the weather from last launch beside the brand mark while the
 * face waited on the network (owner, on device): the two are now on the same footing. `ready`
 * still waits for a LIVE answer, so the cached pick can be drawn but never drawn OVER by
 * `useEnsureCoachFace`'s random draw.
 *
 * The write is optimistic and NOT rolled back on failure. That is deliberate: the only thing at
 * stake is which picture is on screen, the user can see the result of their own tap, and yanking
 * the face back mid-animation to report a network blip is a worse experience than a pick that
 * quietly needs repeating on the next visit. Anything with real consequence would roll back.
 */
export function CoachFaceProvider({ children, authReady = true }: { children: ReactNode; authReady?: boolean }) {
  const queryClient = useQueryClient();
  const [faceId, setFaceId] = useState<CoachFaceId | null>(
    () => queryClient.getQueryData<CoachFaceCacheEntry>(queryKeys.coachFace.all)?.face_id ?? null,
  );
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!authReady || ready) return;
    let alive = true;
    void getCoachFace().then((read) => {
      if (!alive || !read.ok) return;
      setFaceId(read.faceId);
      queryClient.setQueryData<CoachFaceCacheEntry>(queryKeys.coachFace.all, { face_id: read.faceId });
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [authReady, ready, queryClient]);

  const persist = useCallback(
    async (id: CoachFaceId | null) => {
      setFaceId(id);
      queryClient.setQueryData<CoachFaceCacheEntry>(queryKeys.coachFace.all, { face_id: id });
      await setCoachFace(id).catch(() => {});
    },
    [queryClient],
  );

  const value = useMemo<CoachFaceState>(
    () => ({ faceId, face: resolveFace(faceId), ready, setFaceId: persist }),
    [faceId, ready, persist],
  );

  return <CoachFaceContext.Provider value={value}>{children}</CoachFaceContext.Provider>;
}
