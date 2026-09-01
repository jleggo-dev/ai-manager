import { useEffect, useRef, useState } from 'react';
import { acceptProposal, dismissProposal, getPendingReplan } from '../../lib/api.ts';
import { useAppResume } from '../../lib/useAppResume.ts';

/**
 * The proposal banner's accept lifecycle, plus the plan view's pending-replan recovery — one
 * owner for every read of GET /plan/replan/pending from this screen.
 *
 * Why it exists (PLAN-CHANGES.md, Phase 0): accepting the coach's weekly proposal used to hold
 * one HTTP request open across a multi-minute synthesize+commit, behind nothing but a disabled
 * button label — and a >300s run was undeliverable even when it succeeded. The server now answers
 * the replan/rebaseline accept with **202 {running: true}** and finishes in the background (it
 * survives the app closing; a push lands on success or failure). This hook watches that run by
 * polling the pending endpoint until it reports done, failed, or nothing at all.
 */

/** The Phase 0 server contract's additions to /plan/replan/pending, read loosely on purpose:
 *  lib/api/plan.ts is being extended in place by the server parcel, and this local view has to
 *  typecheck against both the current and the extended return types. */
type PendingRun = {
  running?: { stage?: string; startedAt?: string } | null;
  failed?: { message?: string } | null;
};

const POLL_EVERY_MS = 5_000;
/** Generous past the worst measured run (2h45m taught us better ceilings exist server-side now —
 *  the plan_run record fails a stuck run itself; this is just the client giving up watching). */
const POLL_CEILING_MS = 20 * 60_000;

const NOTE_COMMITTED = 'Updated your plan to fit how this stretch has been going.';
const NOTE_DECLINED = "I couldn't adjust it just now — give it another try in a bit.";
const NOTE_HICCUP = 'Something hiccuped on my end — try again in a moment.';

/** One read of the pending endpoint, seen through the loose Phase 0 view. */
async function readPending() {
  const raw = await getPendingReplan();
  return raw as typeof raw & PendingRun;
}

export function useProposalAccept({
  refetch,
  bump,
  clearProposal,
  onRecoveredProposal,
  recoveryPaused,
  pollEveryMs = POLL_EVERY_MS,
  pollCeilingMs = POLL_CEILING_MS,
}: {
  /** Revalidate the plan query — the landed week has to reach the screen. */
  refetch: () => Promise<unknown>;
  /** Bump the aux-fetch reload key, same as every other landed change. */
  bump: () => void;
  /** Drop the banner's proposal from the local plan cache — the optimistic clear, as today. */
  clearProposal: () => void;
  /** A finished replan proposal is waiting server-side — open the review sheet on it. */
  onRecoveredProposal: () => void;
  /** True while a sheet already owns the screen — a resume re-check must not pop the review over it. */
  recoveryPaused: boolean;
  /** Test seams — real timings make the poll path untestable. */
  pollEveryMs?: number;
  pollCeilingMs?: number;
}) {
  const [note, setNote] = useState('');
  const [proposalBusy, setProposalBusy] = useState(false);
  /** A background rework is live — the banner swaps its buttons for the working line. */
  const [working, setWorking] = useState(false);

  const alive = useRef(true);
  const watching = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deadline = useRef(0);
  // Held in refs so the watch loop and resume listener never act through a stale closure.
  const cb = useRef({ refetch, bump, clearProposal, onRecoveredProposal, recoveryPaused });
  cb.current = { refetch, bump, clearProposal, onRecoveredProposal, recoveryPaused };

  function stopWatch() {
    watching.current = false;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setWorking(false);
  }

  function startWatch() {
    if (watching.current || !alive.current) return;
    watching.current = true;
    deadline.current = Date.now() + pollCeilingMs;
    setWorking(true);
    timer.current = setTimeout(() => void watchStep(), pollEveryMs);
  }

  async function watchStep() {
    timer.current = null;
    if (!alive.current || !watching.current) return;
    const r = await readPending();
    if (!alive.current || !watching.current) return;
    if (r.proposal) {
      // The run landed as a reviewable proposal (an Adjust-path run we rejoined) — show it.
      stopWatch();
      cb.current.onRecoveredProposal();
      return;
    }
    if (r.failed) {
      // Buttons come back (the banner's proposal was never cleared) + the failure, out loud.
      stopWatch();
      setNote(r.failed.message?.trim() || NOTE_DECLINED);
      return;
    }
    if (r.running || !r.ok) {
      // Still going — or a read that failed, which is UNKNOWN, not an answer. Keep watching.
      if (Date.now() >= deadline.current) {
        stopWatch();
        setNote(NOTE_HICCUP);
        return;
      }
      timer.current = setTimeout(() => void watchStep(), pollEveryMs);
      return;
    }
    // ok, nothing running, nothing failed: the run finished and committed. Land it.
    stopWatch();
    cb.current.clearProposal();
    await cb.current.refetch();
    cb.current.bump();
    setNote(NOTE_COMMITTED);
  }

  async function acceptProp() {
    if (proposalBusy || watching.current) return;
    setProposalBusy(true);
    setNote('');
    try {
      const raw = await acceptProposal();
      const r = raw as typeof raw & { running?: boolean }; // loose for the same in-flight-extension reason as PendingRun
      if (r.running) {
        // 202 — the synthesize+commit runs server-side now; the banner shows the working line
        // and the proposal stays in the cache so a failure can hand the buttons back.
        startWatch();
        return;
      }
      cb.current.clearProposal();
      if (r.status === 'committed') {
        setNote(r.note?.trim() || NOTE_COMMITTED);
        await cb.current.refetch();
        cb.current.bump();
      } else if (r.status === 'entered_disrupted') {
        await cb.current.refetch(); // the detour banner + paused overlay appear — that's the feedback
        cb.current.bump();
      } else {
        setNote(NOTE_DECLINED);
      }
    } catch {
      setNote(NOTE_HICCUP);
    } finally {
      setProposalBusy(false);
    }
  }

  function dismissProp() {
    cb.current.clearProposal();
    dismissProposal().catch(() => {});
  }

  /**
   * A week the coach drew must find its way to the screen. Any server-side path (a script, a
   * proactive flow, an accept that outlived the app) stores its result durably — but until this
   * ran, the ONLY in-app surface was a live Adjust flow the user had started themselves: a
   * finished 16-activity rebalance sat invisible in pending_plan while its owner asked where it
   * was (2026-08-31). On mount, ask; a waiting proposal opens the review sheet, and a live
   * background run is rejoined (the working banner comes back) instead of being shown buttons
   * that would only re-fire it. Suggest-never-auto-apply is untouched — the sheet still ends in
   * their Apply.
   *
   * Retries, because the first mount races auth (paint-before-auth, #311): the tokenless read
   * 401s, and a failed read is UNKNOWN — treating it as "nothing pending" hid a finished
   * rebalance until the owner left the screen and came back. A real "nothing pending" answer
   * stops the loop on the first try.
   */
  useEffect(() => {
    alive.current = true;
    const delays = [0, 2000, 5000, 12000];
    void (async () => {
      for (const ms of delays) {
        if (ms) await new Promise((res) => setTimeout(res, ms));
        if (!alive.current) return;
        const r = await readPending();
        if (!alive.current) return;
        if (r.proposal) {
          cb.current.onRecoveredProposal();
          return;
        }
        if (r.running) {
          startWatch();
          return;
        }
        if (r.ok) return; // a genuine "nothing pending" — done
      }
    })();
    return () => {
      alive.current = false;
      watching.current = false;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * The foreground half of the same recovery (Phase 0): the mount poll only ever ran once, so a
   * user sitting on the Plan tab never saw a proposal that landed after it — leaving the screen
   * and coming back was the only door. One cheap fetch per resume, no interval; the mount loop's
   * retries aren't needed here because a resumed app has a warm token. The in-flight guard is
   * load-bearing: on web builds one foreground fires BOTH of useAppResume's doors (Capacitor's
   * web App plugin relays visibilitychange as appStateChange), and "one fetch per resume" has to
   * survive that.
   */
  const resumeChecking = useRef(false);
  useAppResume(() => {
    if (resumeChecking.current) return;
    resumeChecking.current = true;
    void (async () => {
      try {
        const r = await readPending();
        if (!alive.current) return;
        if (r.proposal) {
          if (cb.current.recoveryPaused) return; // a sheet owns the screen — its own pending-first check has this
          stopWatch();
          cb.current.onRecoveredProposal();
          return;
        }
        if (r.running) startWatch();
      } finally {
        resumeChecking.current = false;
      }
    })();
  });

  return { note, setNote, proposalBusy, working, acceptProp, dismissProp };
}
