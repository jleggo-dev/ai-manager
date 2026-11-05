import { useCallback, useEffect, useState } from 'react';
import type { TimerClock } from './StepTimer.tsx';

/** 100 ms, like the breath pacer: the ring's current wedge fills continuously, and a 1 s tick
 *  makes that visibly steppy. Only runs while the interval is actually running. */
const TICK_MS = 100;

export interface IntervalClock {
  /** Seconds since the run began, excluding time spent paused. */
  elapsed: number;
  running: boolean;
  /** The run in progress — the instant it began and the seconds banked before it — or null while
   *  paused. What the app-level clock store and the remembered session are told. */
  mark: TimerClock | null;
  start: () => void;
  pause: () => void;
  /** Back to zero, un-started. */
  reset: () => void;
  /** Jump forward to an absolute elapsed mark — how "Skip phase ›" works. */
  seek: (seconds: number) => void;
}

/**
 * The interval player's clock. Like `useBreathClock` it measures from a **wall-clock mark** rather
 * than accumulating ticks — `positionAt` is a pure function of elapsed time, so drift would slide
 * the ring out of step with the chimes, and a backgrounded tab has to resume in the right phase
 * rather than however many frames behind it fell.
 *
 * Unlike the breath pacer this one **pauses**, because mid-workout interruptions are ordinary: a
 * pause banks the elapsed seconds and the next start re-marks the wall clock from there. Pause
 * never rewinds the phase.
 *
 * `resume` is a run that was already going when this card was last seen — on another tab, or
 * before the app was relaunched — and the clock opens running from that mark, caught up.
 */
export function useIntervalClock(initialElapsed = 0, resume?: TimerClock | null): IntervalClock {
  const [mark, setMark] = useState<TimerClock | null>(resume ?? null);
  const [banked, setBanked] = useState(resume?.base ?? initialElapsed);
  const [now, setNow] = useState(() => Date.now());
  const running = mark !== null;

  useEffect(() => {
    if (!mark) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [mark]);

  const elapsed = mark ? mark.base + Math.max(0, now - mark.startedAt) / 1000 : banked;

  const start = useCallback(() => {
    setMark((was) => was ?? { startedAt: Date.now(), base: banked });
  }, [banked]);

  const pause = useCallback(() => {
    if (mark) setBanked(mark.base + Math.max(0, Date.now() - mark.startedAt) / 1000);
    setMark(null);
  }, [mark]);

  const reset = useCallback(() => {
    setMark(null);
    setBanked(0);
  }, []);

  // Seeking mid-run re-marks the wall clock so the jump doesn't get undone by the next tick.
  const seek = useCallback((seconds: number) => {
    const at = Math.max(0, seconds);
    setBanked(at);
    setMark((was) => (was ? { startedAt: Date.now(), base: at } : null));
  }, []);

  return { elapsed, running, mark, start, pause, reset, seek };
}
