import { useEffect, useRef, useState } from 'react';
import type { PendingPlanActivity } from '@cadence/shared';
import { confirmGoals, previewReplan, getPendingReplan } from '../../lib/api.ts';
import { useAppResume } from '../../lib/useAppResume.ts';

export type ReplanProposal = { activities: PendingPlanActivity[]; note: string };
export type ReplanPhase = 'idle' | 'thinking' | 'failed';
/** The run's real stage, reported by the server's durable run record — never guessed here. */
export type ReplanStage = 'reading' | 'drafting' | 'saving';

/**
 * Asking for an adjustment, and getting one back — however long that takes and wherever the
 * person goes in the meantime.
 *
 * The synthesis no longer rides on any request this client holds open. `POST /plan/replan/preview`
 * answers 202 the moment the run is recorded; the run itself is durable server-side and SURVIVES
 * the app being closed, backgrounded, or the phone going in a pocket. So this hook has exactly one
 * delivery path: poll `GET /plan/replan/pending` until the server hands down a verdict —
 * a finished proposal, or a failure in the server's own words. While it waits, the server also
 * reports which stage the run is actually in (reading → drafting → saving), so the waiting copy
 * states facts instead of guessing from the clock — the old sheet showed one unchanging line for
 * 271 measured seconds, and the owner's verdict was the only one available: *"It says it's
 * working on options … it never replies — I can't tell if it's working or not."*
 *
 * `useAppResume` stays: a suspended webview's poll timer isn't running, so coming back triggers
 * an immediate extra tick instead of waiting out a sleep that never slept.
 */

/** How often to ask the server for the verdict. */
const POLL_EVERY_MS = 4_000;
/**
 * How long to keep asking before conceding. Far past any healthy run — but a run CAN legitimately
 * retry server-side, and if it finishes after we stop looking, the push and the plan view's
 * mount-time pending check still deliver it.
 */
const POLL_CEILING_MS = 20 * 60_000;
/** How often the elapsed counter re-renders the waiting copy. */
const TICK_MS = 1_000;

/**
 * What she says while she works — keyed to the run's REAL stage. `null` covers the beat between
 * the tap and the first stage report; a run always begins by reading, so the reading line is the
 * honest cover for it.
 */
export function waitingNote(stage: ReplanStage | null): string {
  if (stage === 'drafting') return 'Drafting the changes — this is the long part…';
  if (stage === 'saving') return 'Writing it down…';
  return 'Reading back through your goals and your week…';
}

export function useReplanPreview({
  steer,
  adoptCaptured,
  autoStart = false,
  pollEveryMs = POLL_EVERY_MS,
  pollCeilingMs = POLL_CEILING_MS,
}: {
  steer: () => string;
  adoptCaptured: boolean;
  /**
   * Start a synthesis on mount (the rebalance card's shape: review IS the action) — but only when
   * the mount-time pending check SUCCEEDED and found nothing at all. A proposal already waiting is
   * shown; a run already in flight is joined; and a FAILED check is UNKNOWN — firing a fresh
   * synthesis over a proposal we merely could not read (the paint-before-auth 401, a network
   * blip) would clobber a finished week and spend minutes of model time replacing it.
   */
  autoStart?: boolean;
  /** Test seams — real timings make the poll path untestable. */
  pollEveryMs?: number;
  pollCeilingMs?: number;
}) {
  const [phase, setPhase] = useState<ReplanPhase>('idle');
  const [proposal, setProposal] = useState<ReplanProposal | null>(null);
  const [stage, setStage] = useState<ReplanStage | null>(null);
  const [error, setError] = useState('');
  const [elapsedMs, setElapsedMs] = useState(0);
  /** Set the moment THIS run concludes (proposal or failure), so late poll answers and resume
   *  checks can only land once. Reset by start(). */
  const concluded = useRef(false);
  /** One poll loop at a time, no matter which door opened it. */
  const polling = useRef(false);
  /** Unmount stops the loop — the run is server-durable, so nothing is lost by leaving. */
  const alive = useRef(true);
  const startedAt = useRef(0);

  const running = phase === 'thinking';

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  function settle(p: ReplanProposal) {
    if (concluded.current) return;
    concluded.current = true;
    setProposal(p);
    setStage(null);
    setPhase('idle');
  }

  function fail(message: string) {
    if (concluded.current) return;
    concluded.current = true;
    setStage(null);
    setError(message);
    setPhase('failed');
  }

  /** Adopt the server's record: its stage, and its clock — so the elapsed counter shows the run's
   *  real age, which matters when we join a run someone (or something) else started. */
  function adoptRun(run: { stage: ReplanStage; startedAt: string }) {
    setStage(run.stage);
    const t = Date.parse(run.startedAt);
    if (Number.isFinite(t) && t < Date.now()) {
      startedAt.current = t;
      setElapsedMs(Date.now() - t);
    }
  }

  /**
   * The one delivery path. The run is durable server-side, so the client's only job is to keep
   * asking until there is a verdict: proposal → show it; failed → say so in the server's words.
   * Anything else — a network blip, a plain-null read racing the run record's creation — is not
   * a verdict, so ask again. Only the ceiling gets out without one.
   */
  async function poll(): Promise<void> {
    if (polling.current) return;
    polling.current = true;
    try {
      const deadline = Date.now() + pollCeilingMs;
      while (alive.current && !concluded.current && Date.now() < deadline) {
        const r = await getPendingReplan();
        if (!alive.current || concluded.current) return;
        if (r.proposal) return settle(r.proposal);
        if (r.ok && r.failed) return fail(r.failed.message);
        if (r.ok && r.running) adoptRun(r.running);
        await new Promise((res) => setTimeout(res, pollEveryMs));
      }
      if (alive.current && !concluded.current) {
        fail('Something hiccuped on my end — try again in a moment.');
      }
    } finally {
      polling.current = false;
    }
  }

  /**
   * Pending first, on mount. Whatever opened this sheet, the server's record is the answer: a
   * stored proposal is shown, a live run is joined (poll it — never a second POST), a failed run
   * is reported in its own words with Try again waiting. Only a successful check that found
   * nothing at all lets autoStart spend a synthesis (see the autoStart doc above).
   */
  useEffect(() => {
    let live = true;
    void getPendingReplan().then((r) => {
      if (!live || concluded.current) return;
      if (r.proposal) return settle(r.proposal);
      if (r.ok && r.failed) return fail(r.failed.message);
      if (r.ok && r.running) {
        adoptRun(r.running);
        setPhase('thinking');
        void poll();
        return;
      }
      if (r.ok && autoStart) void start();
    });
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The elapsed counter is the difference between "frozen" and "working" on a screen with no
  // other movement — it is doing honest work, not decoration.
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setElapsedMs(Date.now() - startedAt.current), TICK_MS);
    return () => clearInterval(id);
  }, [running]);

  /**
   * Coming back is just another poll tick — but an immediate one: a suspended webview's timers
   * weren't running, and someone who left mid-run has quite likely returned to a verdict.
   */
  useAppResume(() => {
    if (concluded.current || !running) return;
    void getPendingReplan().then((r) => {
      if (concluded.current) return;
      if (r.proposal) settle(r.proposal);
      else if (r.ok && r.failed) fail(r.failed.message);
      else if (r.ok && r.running) adoptRun(r.running);
    });
  }, running);

  async function start(): Promise<void> {
    if (running) return;
    concluded.current = false;
    startedAt.current = Date.now();
    setElapsedMs(0);
    setError('');
    setStage(null);
    setPhase('thinking');
    // Before synthesis, not after: a captured-but-unconfirmed goal is invisible to the re-plan.
    if (adoptCaptured) await confirmGoals().catch(() => undefined);
    const r = await previewReplan(steer());
    if (!alive.current || concluded.current) return;
    if (r.invalid) {
      // A definite 400: the request never became a run, so there is nothing to poll for.
      return fail(r.error || "I couldn't make sense of that request — try wording it differently.");
    }
    // Everything else polls — including a POST that failed outright: the ask may have landed
    // server-side even though the 202 never made it back, and the run outlives this client either
    // way. `joined: true` is the same story from the other side: a run was already going.
    await poll();
  }

  return {
    phase,
    busy: running,
    proposal,
    error,
    /** The run's real stage, verbatim from the server — null before the first stage report. */
    stage,
    /** Live copy for the waiting state — what she is actually doing, not a guess from the clock. */
    note: waitingNote(stage),
    elapsedMs,
    start,
    /** Drop a proposal locally (the commit failed and it is no longer valid to show). */
    clearProposal: () => setProposal(null),
    setError,
  };
}
