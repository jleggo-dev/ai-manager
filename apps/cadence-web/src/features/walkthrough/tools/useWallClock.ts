import { useEffect, useState } from 'react';
import { useAppResume } from '../../../lib/useAppResume.ts';

/**
 * Seconds elapsed, read off the WALL CLOCK rather than counted in ticks.
 *
 * A timer that does `elapsed + 1` every `setInterval` second only keeps time while the page is
 * awake. Leave the app to start a podcast and the interval is throttled, then suspended; come back
 * twenty minutes later and the ruck timer has moved a few seconds (2026-09-06). So the running
 * state is an INSTANT — `startedAt` — and elapsed is derived from it on every render: how long
 * ago that was, plus whatever had been done before the last pause. Sleeping loses nothing,
 * because nothing was being accumulated.
 *
 * The interval here only repaints; it can be throttled or stopped and the number stays right.
 * A foreground resume forces one repaint so the catch-up is immediate rather than up to a tick
 * away, and so a completion that happened while asleep is noticed the moment the screen is back.
 */
export function useWallClock(startedAt: number | null, base: number): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (startedAt == null) return undefined;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [startedAt]);

  useAppResume(() => setNow(Date.now()), startedAt != null);

  if (startedAt == null) return base;
  return base + Math.max(0, Math.floor((now - startedAt) / 1000));
}
