import { useEffect, useRef } from 'react';
import { registerClock, type RunningClockSpec } from './runningClock.ts';

/**
 * Keep the store's clock in step with a tool's: whenever `spec` is a running clock, it is
 * registered (runningClock.ts), and any change to it — a resume from a new instant, a minute
 * added, the chime switched off, a plan edited — registers it again so the chimes are rescheduled.
 *
 * Deliberately NO cleanup on unmount: the whole point is that the clock outlives the tool. Letting
 * go is an explicit act — pause, stop, finish — and the tool calls `unregisterClock` there.
 *
 * Keyed on the spec's own fields, not its identity, so a re-render that rebuilds the same object
 * does not re-arm every timeout.
 */
export function useRegisteredClock(spec: RunningClockSpec | null): void {
  const latest = useRef(spec);
  latest.current = spec;
  const key = spec ? JSON.stringify(spec) : null;
  useEffect(() => {
    const s = latest.current;
    if (key !== null && s) registerClock(s);
  }, [key]);
}
