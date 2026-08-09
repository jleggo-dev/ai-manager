import { createContext, useContext } from 'react';
import { coachFace, type CoachFace, type CoachFaceId } from '@cadence/shared';

/**
 * Which portrait the user picked, held once for the whole signed-in app.
 *
 * It is context rather than a per-component fetch because the face appears on half a dozen
 * surfaces at once (header, recap, trail bay, every sheet Cadence speaks from) and they must
 * never disagree — a swap in Settings has to land everywhere in the same frame, not as a
 * ripple of independent refetches.
 *
 * `faceId: null` is a first-class state meaning "hasn't picked", not "still loading" — see
 * `ready` for that. Both render the brand mark, but only one of them should ever prompt.
 *
 * In practice onboarding fills this in before the first turn (MeetCadence draws one at random and
 * keeps it), so null on a live account means they went to Settings and cleared it deliberately.
 */
export interface CoachFaceState {
  /** The chosen id, or null for "hasn't picked". */
  faceId: CoachFaceId | null;
  /** The resolved face (art guaranteed non-null), or null → callers fall back to `<Orb>`. */
  face: CoachFace | null;
  /** False until the first load settles, so nothing offers the picker on a flash of null. */
  ready: boolean;
  /** Persist a pick (or null to clear). Optimistic: the UI swaps immediately. */
  setFaceId: (id: CoachFaceId | null) => Promise<void>;
}

export const CoachFaceContext = createContext<CoachFaceState>({
  faceId: null,
  face: null,
  ready: false,
  setFaceId: async () => {},
});

export function useCoachFace(): CoachFaceState {
  return useContext(CoachFaceContext);
}

/** Resolve an id to a drawable face — exported so tests and the picker share one code path. */
export function resolveFace(id: CoachFaceId | null): CoachFace | null {
  return coachFace(id);
}
