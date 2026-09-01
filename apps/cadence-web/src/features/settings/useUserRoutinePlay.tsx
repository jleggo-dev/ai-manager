import { useState, type ReactNode } from 'react';
import { deriveWalkthrough } from '@cadence/shared';
import { logUserRoutineRun, type UserRoutine } from '../../lib/api.ts';
import { Walkthrough } from '../walkthrough/Walkthrough.tsx';

/**
 * Play-then-credit for a routine YOU built (Activity Builder wave 3, "Run it now" — Settings ›
 * Your activities). Simpler than the coach-routine sibling `plan/quick-add/useRoutinePlay.tsx`:
 * a `UserRoutine` already carries its full `session` (the built steps, not a summary), so there is
 * no fetch to make first — `deriveWalkthrough` runs straight off `routine.session` and the
 * walkthrough opens the same tick `play()` is called.
 *
 * Crediting is one call, `logUserRoutineRun(routine_id)` — a done occurrence on the routine's own
 * companion activity, no `logDid`/`activity_id` involved (that's the coach-routine shape; a
 * user-built activity's server side is its own thing). Best-effort like every other completed
 * path here: `onLogged` always fires, even if the credit write itself failed, so a person is never
 * stranded on a screen that already told them they finished.
 */
export interface UseUserRoutinePlayResult {
  /** Non-null while a routine's walkthrough is on screen — render this IN PLACE of the settings
   *  list, the same swap `useRoutinePlay` makes for the plan's own now-menu. */
  node: ReactNode | null;
  /** The routine_id currently playing, or null. */
  activeId: string | null;
  /** Open `routine`'s walkthrough straight from its own session. Finishing credits the routine
   *  (`logUserRoutineRun`) and then calls `onLogged(routine_id)`. Closing without finishing just
   *  clears `node`; nothing is logged. */
  play: (routine: UserRoutine) => void;
}

export function useUserRoutinePlay(onLogged: (routineId: string) => void): UseUserRoutinePlayResult {
  const [active, setActive] = useState<UserRoutine | null>(null);

  function play(routine: UserRoutine) {
    setActive(routine);
  }

  const node: ReactNode | null = active ? (
    <Walkthrough
      walkthrough={deriveWalkthrough(active.session)}
      title={active.name}
      onClose={() => setActive(null)}
      onComplete={() => {
        const routineId = active.routine_id;
        setActive(null);
        // logUserRoutineRun, THEN onLogged — same order every other completed path here follows
        // (see useRoutinePlay's logDid). A failed credit write must not strand someone on a screen
        // that already told them they finished, so onLogged still fires; the write is not retried.
        void (async () => {
          try {
            await logUserRoutineRun(routineId);
          } finally {
            onLogged(routineId);
          }
        })();
      }}
    />
  ) : null;

  return { node, activeId: active?.routine_id ?? null, play };
}
