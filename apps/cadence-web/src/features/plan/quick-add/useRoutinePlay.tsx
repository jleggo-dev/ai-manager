import { useState, type ReactNode } from 'react';
import { deriveWalkthrough, type OccurrenceSession } from '@cadence/shared';
import { getRoutineSession, logDid, type PlanRoutine } from '../../../lib/api.ts';
import { Walkthrough } from '../../walkthrough/Walkthrough.tsx';

/**
 * Play-then-credit for a coach-built routine (Activity Builder 2A, "Take me on one" — the routines
 * half). A routine row only carries step NAMES (`PlanRoutine.steps`); the full session — what the
 * walkthrough actually needs — is fetched here, on tap, not up front: the shelf lists rows the
 * user may never open, so paying for a full session read per row would be wasted work.
 *
 * Self-contained on purpose: the caller hands in `onLogged` and a `PlanRoutine` and gets back
 * something to render — it never has to know about `OccurrenceSession`, `deriveWalkthrough`, or
 * the credit write itself. The shortcut-pill parcel (QuickAddSheet.tsx) reuses this exact hook to
 * run a promoted routine straight from its own pill, without duplicating any of this.
 */

export interface RoutinePlayError {
  commitmentId: string;
  text: string;
}

export interface UseRoutinePlayResult {
  /** Non-null while a routine's session is loading or its walkthrough is on screen — render this
   *  IN PLACE of whatever screen called `play` (the same swap QuickAddTense already makes for a
   *  now-menu item: `if (playing) return <Walkthrough .../>`). */
  node: ReactNode | null;
  /** The commitment_id whose session fetch is in flight, or null. A row should go inert while
   *  `busyId` matches its own id, so a second tap can't fire a second fetch. */
  busyId: string | null;
  /** The most recent row-level failure — cleared the instant a new `play()` call starts (for ANY
   *  routine). Render `text` under the ONE row whose `commitmentId` matches; every other row is
   *  unaffected. */
  error: RoutinePlayError | null;
  /** Fetch `routine.commitment_id`'s session and open the walkthrough once it's there. Finishing
   *  credits `routine.activity_id` (`logDid`) and then calls the `onLogged` this hook was given —
   *  the same "log it, then close" contract every other path in QuickAddTense already uses.
   *  Closing without finishing just clears `node`; nothing is logged. */
  play: (routine: PlanRoutine) => void;
}

/** `ok: false` — the fetch itself failed (network, non-OK). Never dressed as "nothing to play":
 *  the row says try again, not that the routine is gone. Exported so the Start-from screen
 *  (StartFromScreen.tsx) can show the exact same line on its own `getRoutineSession` read for a
 *  "From the coach" pick, rather than a copy-pasted duplicate that could drift from this one. */
export const FETCH_FAILED = "Couldn't open that one just now — try again in a moment.";
/** `ok: true, session: null` — the listing said this routine had steps, but the cached session
 *  behind them is gone by the time of the tap (replaced by a newer prescribe_session run
 *  elsewhere). A real gap, not a mistake the user made, so the line stays plain and carries no
 *  blame — it never says "your session expired" or anything else that reads as their fault. */
export const SESSION_GONE = 'Nothing to play there right now — try again in a moment.';

export function useRoutinePlay(onLogged: () => void): UseRoutinePlayResult {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<RoutinePlayError | null>(null);
  const [active, setActive] = useState<{ routine: PlanRoutine; session: OccurrenceSession } | null>(null);

  function play(routine: PlanRoutine) {
    setError(null);
    setBusyId(routine.commitment_id);
    void getRoutineSession(routine.commitment_id).then(({ ok, session }) => {
      setBusyId((id) => (id === routine.commitment_id ? null : id));
      if (!ok) {
        setError({ commitmentId: routine.commitment_id, text: FETCH_FAILED });
        return;
      }
      if (!session) {
        setError({ commitmentId: routine.commitment_id, text: SESSION_GONE });
        return;
      }
      setActive({ routine, session });
    });
  }

  const node: ReactNode | null = active ? (
    <Walkthrough
      walkthrough={deriveWalkthrough(active.session)}
      title={active.routine.title}
      onClose={() => setActive(null)}
      onComplete={() => {
        const activityId = active.routine.activity_id;
        setActive(null);
        // logDid, THEN onLogged — same order every other completed path in QuickAddTense follows.
        // A failed credit write must not strand the person on a screen that already told them
        // they finished, so onLogged still fires; the write itself is not retried here.
        void (async () => {
          try {
            await logDid(activityId);
          } finally {
            onLogged();
          }
        })();
      }}
    />
  ) : null;

  return { node, busyId, error, play };
}
