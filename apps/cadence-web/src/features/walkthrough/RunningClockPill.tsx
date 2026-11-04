import { useEffect, useState } from 'react';
import { clockLine, useRunningClock } from './runningClock.ts';

/**
 * The running clock on every screen that is not the walkthrough: one line — the step and what is
 * left, or the interval's phase — and a tap back to the step. Shown while a clock is registered
 * (runningClock.ts), gone otherwise. Interim look; no design round.
 */
export function RunningClockPill({ onOpen }: { onOpen: () => void }) {
  const clock = useRunningClock();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!clock) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [clock]);

  if (!clock) return null;
  return (
    <button type="button" className="clock-pill" onClick={onOpen} aria-label="Back to the clock">
      {clockLine(clock, now)}
    </button>
  );
}
