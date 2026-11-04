import { useEffect, useState } from 'react';
import type { TimerClock } from './StepTimer.tsx';

/** How often the pacer samples. A breath phase changes shape continuously, so this is finer than
 *  the timer's 1 s tick — but still cheap, and it only runs while breathing. */
const TICK_MS = 100;

export interface BreathClock {
  elapsed: number;
  /** The run in progress — when it began and what was banked before — or null while idle. */
  mark: TimerClock | null;
}

/**
 * Elapsed seconds while `running`, measured from a wall-clock start rather than accumulated from
 * ticks. This matters more here than for the timer: `phaseAt` is a pure function of elapsed time,
 * so if the clock drifted the animation would slide out of step with the counts. Reading the wall
 * clock each tick means a throttled or backgrounded tab resumes in exactly the right place instead
 * of falling behind by however many frames it missed.
 *
 * Pausing is not supported by design — a breath pattern half-finished is a partial round, not a
 * paused one. Stopping logs what was done and the next start begins a fresh run from zero.
 *
 * `resume` is a run that was already going when this card was last seen (another tab, a relaunch):
 * the clock opens from that mark, caught up, rather than from zero.
 */
export function useBreathClock(running: boolean, resume?: TimerClock | null): BreathClock {
  const [mark, setMark] = useState<TimerClock | null>(resume ?? null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running) {
      setMark(null);
      return undefined;
    }
    setMark((was) => was ?? { startedAt: Date.now(), base: 0 });
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, [running]);

  const elapsed = running && mark ? mark.base + Math.max(0, now - mark.startedAt) / 1000 : 0;
  return { elapsed, mark: running ? mark : null };
}
