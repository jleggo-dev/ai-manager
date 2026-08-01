import { useEffect, useRef, useState } from 'react';

/** How often the pacer samples. A breath phase changes shape continuously, so this is finer than
 *  the timer's 1 s tick — but still cheap, and it only runs while breathing. */
const TICK_MS = 100;

/**
 * Elapsed seconds while `running`, measured from a wall-clock start rather than accumulated from
 * ticks. This matters more here than for the timer: `phaseAt` is a pure function of elapsed time,
 * so if the clock drifted the animation would slide out of step with the counts. Reading the wall
 * clock each tick means a throttled or backgrounded tab resumes in exactly the right place instead
 * of falling behind by however many frames it missed.
 *
 * Pausing is not supported by design — a breath pattern half-finished is a partial round, not a
 * paused one. Stopping logs what was done and the next start begins a fresh run from zero.
 */
export function useBreathClock(running: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  const startedAt = useRef<number | null>(null);

  useEffect(() => {
    if (!running) {
      startedAt.current = null;
      setElapsed(0);
      return undefined;
    }
    startedAt.current = Date.now();
    setElapsed(0);
    const id = setInterval(() => {
      const t0 = startedAt.current;
      if (t0 !== null) setElapsed((Date.now() - t0) / 1000);
    }, TICK_MS);
    return () => clearInterval(id);
  }, [running]);

  return elapsed;
}
