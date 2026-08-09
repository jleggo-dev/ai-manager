import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { CoachFaceId } from '@cadence/shared';
import { getCoachFace, setCoachFace } from '../../lib/api.ts';
import { CoachFaceContext, resolveFace, type CoachFaceState } from './coachFaceContext.ts';

/**
 * Loads the picked portrait once for the signed-in app and keeps every surface in step.
 *
 * The write is optimistic and NOT rolled back on failure. That is deliberate: the only thing at
 * stake is which picture is on screen, the user can see the result of their own tap, and yanking
 * the face back mid-animation to report a network blip is a worse experience than a pick that
 * quietly needs repeating on the next visit. Anything with real consequence would roll back.
 */
export function CoachFaceProvider({ children }: { children: ReactNode }) {
  const [faceId, setFaceId] = useState<CoachFaceId | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let alive = true;
    void getCoachFace().then((id) => {
      if (!alive) return;
      setFaceId(id);
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const persist = useCallback(async (id: CoachFaceId | null) => {
    setFaceId(id);
    await setCoachFace(id).catch(() => {});
  }, []);

  const value = useMemo<CoachFaceState>(
    () => ({ faceId, face: resolveFace(faceId), ready, setFaceId: persist }),
    [faceId, ready, persist],
  );

  return <CoachFaceContext.Provider value={value}>{children}</CoachFaceContext.Provider>;
}
