import { useRef, type MutableRefObject } from 'react';
import { getCurrentCoach, notifyOnCoachReply } from '../../lib/api.ts';
import { useAppResume } from '../../lib/useAppResume.ts';
import { useAppLeave } from '../../lib/useAppLeave.ts';
// Type-only, so this is erased at runtime and no cycle exists (coachTurns.ts does the same).
import type { CoachTurn } from './useCoachChat.ts';

/**
 * Getting a turn back from the server after the connection died — the healer behind both the
 * dropped-stream path and the app-resume path.
 *
 * Lives apart from `useCoachChat` because it is a self-contained conversation with the server
 * (poll, judge, adopt) with no React in it, and because the hook hit its size gate: this is the
 * piece with its own reasons, so this is the piece that leaves.
 */

const RECOVER_ATTEMPTS = 6;
const RECOVER_DELAY_MS = 800;
/**
 * How long recovery will wait on a reply the server says it is STILL WRITING. This is the
 * backgrounded-phone path: iOS killed our stream mid-turn, the relay drained it to completion
 * server-side, and on return `generating: true` means the only correct move is patience — the
 * old fixed six polls gave up in ~5s and told someone their connection dropped while the reply
 * was arriving fine. Bounded so a server that wedged mid-turn can't hold the composer hostage.
 */
const RECOVER_GENERATING_MS = 120_000;

export interface RecoverDeps {
  /** Injected so tests don't wait in real time. */
  wait: (ms: number) => Promise<void>;
  /** Adopt the authoritative transcript. */
  onRecovered: (sessionId: string, turns: CoachTurn[]) => void;
}

/**
 * Pull the authoritative conversation back to HEAL a dropped turn. Patient by design: a fixed
 * number of quick polls for the ordinary blip, then — as long as the server says a reply is
 * STILL GENERATING — it keeps waiting up to RECOVER_GENERATING_MS, because the relay drains
 * dropped streams to completion and a backgrounded phone returning mid-write is the normal case,
 * not the edge case.
 *
 * Returns true only when a real coach reply is on file and has been adopted.
 */
export async function recoverTurnFromServer(deps: RecoverDeps): Promise<boolean> {
  const deadline = Date.now() + RECOVER_GENERATING_MS;
  for (let i = 0; ; i++) {
    await deps.wait(RECOVER_DELAY_MS);
    let generating = false;
    try {
      const c = await getCurrentCoach();
      // A STALE thread is not a recovery — it is a resurrection. This healer exists for the
      // turn that just dropped, and the restore path already refuses stale threads; ignoring
      // the flag here let one failed post-signup nudge adopt the GRADUATED onboarding
      // transcript (confirm card and all) and silently re-point the session at it — observed
      // on device 2026-08-12, presenting as "I signed in and nothing happened".
      if (c.stale) return false;
      generating = c.generating === true;
      const last = c.messages[c.messages.length - 1];
      if (!generating && c.sessionId && last?.role === 'coach' && last.content.trim()) {
        deps.onRecovered(
          c.sessionId,
          c.messages.map((m) => ({ role: m.role, text: m.content })),
        );
        return true;
      }
    } catch {
      /* retry */
    }
    // The quick budget covers blips; only an explicit "still writing" earns more patience.
    if (i >= RECOVER_ATTEMPTS - 1 && !(generating && Date.now() < deadline)) return false;
  }
}

/**
 * The app-resume half of leave-safety, and the bookkeeping it needs.
 *
 * Owns the three facts `useCoachChat` would otherwise carry: whether a turn is in the air (a ref,
 * because listener callbacks close over stale state), whether the healer already collected this
 * turn's reply, and whether a heal is running. Bundled here because they exist only to serve
 * recovery, and the chat hook has its own job.
 *
 * `recovered` is the important one: after a heal succeeds, the send path is still holding a fetch
 * that iOS will never settle. When that corpse finally rejects, its error branches must stay
 * quiet — an apology printed under a reply that arrived fine is its own kind of broken.
 */
/**
 * "Notify me when she's done" — and the window at the start of a fresh thread where there is
 * nothing to say it about.
 *
 * The arming request names the thread in its URL, so it needs `sessionId`. On the FIRST turn of a
 * fresh thread that id does not exist yet: `useResumeHealer.begin()` has already run, but
 * `openCoachSession()` has not come back. Someone who sends a message and immediately switches apps
 * leaves inside that window, and the old code called `notifyOnCoachReply(null)`, which returns at
 * its first line without sending anything. No request, no attempt recorded, no notification, and
 * nothing anywhere saying why. So the intent is remembered and posted the moment the thread has a
 * name — still the same turn, so still the right one to ask about.
 *
 * Lives beside the healer because it is the same story: what the client owes the server about
 * leaving, which the server cannot see for itself.
 */
export function useReplyNotifyArm(sessionId: MutableRefObject<string | null>) {
  /** A leave that could not be sent yet, waiting on the thread to be named. */
  const deferred = useRef(false);

  const arm = () => {
    if (!sessionId.current) {
      deferred.current = true;
      return;
    }
    deferred.current = false;
    void notifyOnCoachReply(sessionId.current);
  };

  return {
    /** They left. Say so now, or as soon as we can. */
    arm,
    /** A turn is going out: an intent left unspent by an earlier one must not arm this one. */
    startTurn() {
      deferred.current = false;
    },
    /** The thread has a name at last — spend an intent that was waiting on it. */
    sessionOpened() {
      if (deferred.current) arm();
    },
  };
}

export function useResumeHealer(deps: {
  recover: () => Promise<boolean>;
  onHealed: () => void;
  /**
   * Fired as the app goes to BACKGROUND with a turn still in the air — the other half of the same
   * story this module tells, and it lives here for the same reason: `streaming` is the ref that
   * knows, and a listener callback would close over stale state anywhere else.
   *
   * It exists because the server cannot see someone leave. A suspended webview's socket does not
   * die on cue, so a reply landing inside iOS's grace period looks exactly like a reply someone is
   * reading, and nobody gets told. iOS keeps JavaScript alive briefly after backgrounding; this is
   * the moment to say "notify me".
   */
  onLeave?: () => void;
}) {
  const streaming = useRef(false);
  const recovered = useRef(false);
  const healing = useRef(false);

  useAppLeave(() => {
    if (streaming.current) deps.onLeave?.();
  });

  useAppResume(() => {
    if (!streaming.current || healing.current) return;
    healing.current = true;
    void deps
      .recover()
      .then((ok) => {
        if (!ok) return;
        recovered.current = true;
        deps.onHealed();
      })
      .finally(() => {
        healing.current = false;
      });
  });

  return {
    streaming,
    recovered,
    /** A turn is going out: nothing has been healed for it yet. */
    begin() {
      streaming.current = true;
      recovered.current = false;
    },
    end() {
      streaming.current = false;
    },
  };
}
