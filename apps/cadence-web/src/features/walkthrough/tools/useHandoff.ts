import { useEffect, useRef } from 'react';

/**
 * The short pause between a tool finishing and the walkthrough moving on — you see "done" for a
 * beat, then the next step arrives.
 *
 * It exists as a hook because the obvious way to write it is wrong, and was wrong in three tools at
 * once. A completion effect that schedules `setTimeout(onDone, N)` and returns
 * `() => clearTimeout(id)` cancels its own hand-off: the same effect calls `setPhase('idle')` to
 * show the finished state, `phase` is in its dependency array, so React runs that cleanup on the
 * very next commit — before the timeout can fire. The step then sits on its "done" screen forever.
 *
 * So the timeout lives in a ref and is cleared only on unmount. Fire-once is the caller's
 * `finished` guard, not the cleanup. `cancel()` is for the case where the user un-finishes the step
 * (Reset, "Go again") inside the hand-off window and should stay put.
 */
export interface Handoff {
  /** Schedule the move to the next step. Replaces any hand-off already pending. */
  schedule: (fn: () => void, ms: number) => void;
  /** Call off a pending hand-off — the user is staying on this step after all. */
  cancel: () => void;
}

export function useHandoff(): Handoff {
  const id = useRef<ReturnType<typeof setTimeout> | null>(null);
  const api = useRef<Handoff>({
    cancel: () => {
      if (id.current !== null) {
        clearTimeout(id.current);
        id.current = null;
      }
    },
    schedule: (fn, ms) => {
      api.current.cancel();
      id.current = setTimeout(fn, ms);
    },
  });

  useEffect(() => () => api.current.cancel(), []);

  return api.current;
}
