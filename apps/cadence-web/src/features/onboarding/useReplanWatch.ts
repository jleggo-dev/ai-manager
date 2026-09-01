import { useEffect, useRef, useState } from 'react';
import { getPendingReplan } from '../../lib/api.ts';

/**
 * The chip above the composer that keeps watch over a rebuild the coach kicked off.
 *
 * Audit gap 5 (docs/cadence/PLAN-CHANGES.md): when a chat turn starts a background week rebuild,
 * the turn ends, the dots go away — and nothing on screen says work is still happening. The owner's
 * requirement is "an LLM in a harness": no plan-changing flow may go silent. This hook is the chat's
 * half of that promise for work that OUTLIVES the turn.
 *
 * The lifecycle, exactly:
 * - After each coach turn ENDS (streaming true → false), ONE check of `GET /plan/replan/pending`.
 *   That single post-turn check is the whole gate — an ordinary turn finds no run and the chip
 *   never appears, so this costs one quiet read per turn and zero pixels.
 * - If the check finds a `running` record, the chip shows and the hook polls every `pollEveryMs`
 *   until the server hands down a verdict.
 * - Proposal (or the run simply gone): the chip swaps to the done line for `doneLingerMs`, then
 *   clears — the card itself lives on the plan surfaces, not here.
 * - Failed: the chip says so plainly and stays until the next turn STARTS — "say the word" only
 *   works if the invitation is still on screen when they go to say it.
 * - A failed READ of the endpoint is unknown, not a verdict — keep watching.
 *
 * The chip never blocks input (it is a status line, not a modal), and it survives tab switches
 * because the Coach tab's chat stays mounted for the whole session (MainTabs).
 */

export type ReplanWatchPhase = 'idle' | 'running' | 'done' | 'failed';

/** The chip's three lines, in her voice. Exported so tests pin the copy, not a paraphrase. */
export const REPLAN_WATCH_LINES: Record<Exclude<ReplanWatchPhase, 'idle'>, string> = {
  running: "Your week is being redrawn — I'll let you know when the card is up.",
  done: 'The reworked week is on your plan.',
  failed: "That rebuild didn't finish — say the word and I'll start it again.",
};

export function useReplanWatch({
  streaming,
  pollEveryMs = 10_000,
  doneLingerMs = 6_000,
}: {
  /** The chat's own streaming flag — its falling edge is "a coach turn just ended". */
  streaming: boolean;
  /** Test seams — real timings make the watch untestable. */
  pollEveryMs?: number;
  doneLingerMs?: number;
}) {
  const [phase, setPhase] = useState<ReplanWatchPhase>('idle');
  /** True only after a post-turn check actually found a run — the gate that keeps ordinary
   *  turns silent, and the reason a stale `failed` record on file never grows a chip. */
  const watching = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const prevStreaming = useRef(streaming);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  useEffect(() => {
    const was = prevStreaming.current;
    prevStreaming.current = streaming;
    if (streaming && !was) {
      // A new turn begins: a verdict chip has had its say. A live watch keeps running — the
      // rebuild does not pause because the conversation moved on.
      setPhase((p) => (p === 'failed' || p === 'done' ? 'idle' : p));
    }
    if (!streaming && was) void check();
    // `check`/`schedule` are stable module-style closures over refs; the edge is the only trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming]);

  function schedule() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void check(), pollEveryMs);
  }

  async function check(): Promise<void> {
    const r = await getPendingReplan();
    if (!alive.current) return;
    if (r.ok && r.running) {
      watching.current = true;
      setPhase('running');
      schedule();
      return;
    }
    // Nothing running, and we were not watching one: an ordinary turn. Stay silent — a proposal
    // or an old failed record found here belongs to the plan surfaces, not to a chip about work
    // this conversation never saw start.
    if (!watching.current) return;
    if (!r.ok) {
      // The READ failed, not the run — unknown is not a verdict, so keep watching.
      schedule();
      return;
    }
    watching.current = false;
    if (r.failed) {
      setPhase('failed');
      return;
    }
    // A proposal on file — or the run concluded and its record already moved on. Either way the
    // waiting is over; say so briefly, then get out of the way.
    setPhase('done');
    timer.current = setTimeout(() => {
      if (alive.current) setPhase((p) => (p === 'done' ? 'idle' : p));
    }, doneLingerMs);
  }

  return {
    phase,
    /** What the chip says right now — null when there is nothing to say (most of the time). */
    line: phase === 'idle' ? null : REPLAN_WATCH_LINES[phase],
  };
}
