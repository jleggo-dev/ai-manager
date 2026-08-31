import { useEffect, useRef, useState } from 'react';
import type { PendingPlanActivity } from '@cadence/shared';
import { confirmGoals, previewReplan, getPendingReplan } from '../../lib/api.ts';
import { useAppResume } from '../../lib/useAppResume.ts';

export type ReplanProposal = { activities: PendingPlanActivity[]; note: string };
export type ReplanPhase = 'idle' | 'thinking' | 'checking' | 'failed';

/**
 * Asking for an adjustment, and getting one back — however long that takes and wherever the
 * person goes in the meantime.
 *
 * **This takes about four and a half minutes.** Measured, not guessed: 271s for four goals
 * (`apps/cadence-api/scripts/probe-replan-preview.ts`), because the server fans out one
 * synthesize_plan draft per goal, reduces them into a coherent week, and vets the result — and it
 * grows with every goal added. The sheet used to show one unchanging "Looking at your options…"
 * for the whole of it and nothing else, so the owner's verdict was the only one available:
 * *"It says it's working on options … it never replies — I can't tell if it's working or not."*
 * It was working. Nobody watches a phone for four minutes on faith.
 *
 * So the wait is now told the truth about itself, and made survivable three ways over — each
 * covering a gap the others don't, the same three as the first-lock build (useBuildPlan):
 *  - the fetch resolving, which is the happy path and still the fastest;
 *  - a poll behind a REJECTED fetch — with an EIGHT-minute window, because the old three-minute
 *    one expired ninety seconds before the pipeline could possibly finish, so recovery was
 *    impossible even in principle;
 *  - `useAppResume`, the one that matters on a real phone: a fetch killed by iOS suspension may
 *    never reject at all, and a suspended webview's poll timer isn't running either.
 * The server also persists the proposal the instant synthesis finishes and pushes "your adjusted
 * week is ready", so the work is never riding on this tab staying alive.
 */

/** Recovery window. Longer than the measured pipeline plus headroom for a slow model day. */
const RECOVER_WINDOW_MS = 8 * 60_000;
const RECOVER_EVERY_MS = 5_000;
/** How often the elapsed counter re-renders the waiting copy. */
const TICK_MS = 1_000;

/**
 * What she says while she works, by how long she has been working. True statements only, and the
 * point of the later ones is permission: at a minute in, the honest thing to say is "this takes a
 * few minutes, go do something else, I'll ping you".
 */
export function waitingNote(elapsedMs: number, checking: boolean): string {
  if (checking) return 'Checking whether it finished while you were away…';
  const s = elapsedMs / 1000;
  if (s < 20) return 'Reading back through your goals and how this stretch has gone…';
  if (s < 60) return 'Working out what to change and what to leave alone…';
  if (s < 150) return 'Fitting it all into a week that actually holds together. This takes a few minutes.';
  return 'Still going — almost there. You can leave the app; I’ll let you know the moment it’s ready.';
}

export function useReplanPreview({
  steer,
  adoptCaptured,
  autoStart = false,
  recoverEveryMs = RECOVER_EVERY_MS,
  recoverWindowMs = RECOVER_WINDOW_MS,
}: {
  steer: () => string;
  adoptCaptured: boolean;
  /**
   * Start a synthesis on mount (the rebalance card's shape: review IS the action) — but PENDING
   * FIRST, always: a proposal may already be waiting server-side, put there by the coach's own
   * dispatch or a previous visit, and synthesizing over it would both clobber the week she drew
   * and spend minutes of model time to replace something already in hand (2026-08-31: a finished
   * 16-activity rebalance sat invisible in pending_plan because nothing outside a live Adjust
   * flow ever looked).
   */
  autoStart?: boolean;
  /** Test seams — real timings make the poll path untestable. */
  recoverEveryMs?: number;
  recoverWindowMs?: number;
}) {
  const [phase, setPhase] = useState<ReplanPhase>('idle');
  const [proposal, setProposal] = useState<ReplanProposal | null>(null);
  const [error, setError] = useState('');
  const [elapsedMs, setElapsedMs] = useState(0);
  /** Set the moment a proposal is in hand, so the fetch and the resume check can only land once. */
  const settled = useRef(false);
  const startedAt = useRef(0);

  const running = phase === 'thinking' || phase === 'checking';

  function settle(p: ReplanProposal) {
    if (settled.current) return;
    settled.current = true;
    setProposal(p);
    setPhase('idle');
  }

  /**
   * Pending first, on mount. Whatever opened this sheet, a proposal already stored server-side is
   * the answer — show it. Only when there is none does `autoStart` spend a synthesis.
   */
  useEffect(() => {
    let alive = true;
    void getPendingReplan()
      .then(({ proposal: p }) => {
        if (!alive || settled.current) return;
        if (p) return settle(p);
        if (autoStart) void start();
      })
      .catch(() => {
        // The check is best-effort; the flow it protects still works without it.
        if (alive && autoStart && !settled.current) void start();
      });
    return () => {
      alive = false;
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
   * Coming back is itself evidence worth acting on. Someone who left during a four-minute
   * synthesis has quite likely returned to a finished proposal — it is persisted server-side the
   * instant it exists — and until this ran, nothing looked for it.
   */
  useAppResume(() => {
    if (settled.current || !running) return;
    void getPendingReplan()
      .then(({ proposal: p }) => {
        if (p) settle(p);
      })
      .catch(() => {
        /* offline on resume — the poll loop and the next resume both still cover this */
      });
  }, running);

  async function start(): Promise<void> {
    if (running) return;
    settled.current = false;
    startedAt.current = Date.now();
    setElapsedMs(0);
    setError('');
    setPhase('thinking');
    try {
      // Before synthesis, not after: a captured-but-unconfirmed goal is invisible to the re-plan.
      if (adoptCaptured) await confirmGoals().catch(() => undefined);
      const r = await previewReplan(steer());
      if (r.status === 'proposed' && r.proposal) return settle(r.proposal);
      setError(r.violations?.join('; ') || "I couldn't put together an adjustment just now — try again in a bit.");
      setPhase('failed');
    } catch {
      // The FETCH died — on a phone, usually the app being backgrounded while the server kept
      // synthesizing. The proposal is persisted the moment it finishes, so poll for THAT before
      // reporting a failure that may not have happened (and before paying for a second synthesis).
      setPhase('checking');
      const deadline = Date.now() + recoverWindowMs;
      while (Date.now() < deadline && !settled.current) {
        try {
          const { proposal: p } = await getPendingReplan();
          if (p) return settle(p);
        } catch {
          /* offline blip — keep polling */
        }
        await new Promise((res) => setTimeout(res, recoverEveryMs));
      }
      if (settled.current) return;
      setError('Something hiccuped on my end — try again in a moment.');
      setPhase('failed');
    }
  }

  return {
    phase,
    busy: running,
    proposal,
    error,
    /** Live copy for the waiting state — moves, and tells the truth about the wait. */
    note: waitingNote(elapsedMs, phase === 'checking'),
    elapsedMs,
    start,
    /** Drop a proposal locally (the commit failed and it is no longer valid to show). */
    clearProposal: () => setProposal(null),
    setError,
  };
}
