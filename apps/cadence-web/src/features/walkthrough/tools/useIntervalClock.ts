import { useCallback, useEffect, useRef, useState } from 'react';

/** 100 ms, like the breath pacer: the ring's current wedge fills continuously, and a 1 s tick
 *  makes that visibly steppy. Only runs while the interval is actually running. */
const TICK_MS = 100;

export interface IntervalClock {
  /** Seconds since the run began, excluding time spent paused. */
  elapsed: number;
  running: boolean;
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
 */
export function useIntervalClock(initialElapsed = 0): IntervalClock {
  const [elapsed, setElapsed] = useState(initialElapsed);
  const [running, setRunning] = useState(false);
  /** Seconds banked before the current run segment began. Seeded from `initialElapsed` so a step
   *  someone paused and walked away from picks up where they left it, not at zero. */
  const banked = useRef(initialElapsed);
  const startedAt = useRef<number | null>(null);

  useEffect(() => {
    if (!running) return undefined;
    const id = setInterval(() => {
      const t0 = startedAt.current;
      if (t0 !== null) setElapsed(banked.current + (Date.now() - t0) / 1000);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [running]);

  const start = useCallback(() => {
    setRunning((was) => {
      if (was) return true;
      startedAt.current = Date.now();
      return true;
    });
  }, []);

  const stopAt = useCallback((seconds: number) => {
    banked.current = seconds;
    startedAt.current = null;
    setElapsed(seconds);
    setRunning(false);
  }, []);

  const pause = useCallback(() => {
    const t0 = startedAt.current;
    stopAt(t0 === null ? banked.current : banked.current + (Date.now() - t0) / 1000);
  }, [stopAt]);

  const reset = useCallback(() => stopAt(0), [stopAt]);

  // Seeking mid-run re-marks the wall clock so the jump doesn't get undone by the next tick.
  const seek = useCallback((seconds: number) => {
    banked.current = Math.max(0, seconds);
    startedAt.current = startedAt.current === null ? null : Date.now();
    setElapsed(banked.current);
  }, []);

  return { elapsed, running, start, pause, reset, seek };
}
