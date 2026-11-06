import { useEffect, useRef, useState } from 'react';

/** Matches the pacer's own sampling, so tuning moves exactly as the real run will. */
const TICK_MS = 100;

/** Where the loop last knew itself to be: `counts` had passed at wall-clock time `wall`. */
interface Anchor {
  wall: number;
  counts: number;
}

function countsAt(anchor: Anchor, wall: number, secondsPerCount: number): number {
  return anchor.counts + (wall - anchor.wall) / 1000 / secondsPerCount;
}

/**
 * Counts elapsed while the person tunes their pace, separate from `useBreathClock` on purpose. A
 * real run has one fixed pace and belongs to the app-level clock store, which measures it in plain
 * seconds. Tuning changes pace on every pixel of a drag, so this clock re-anchors at the present
 * each time: the form glides to the new speed instead of jumping to wherever that pace would have
 * put it from zero. It is never registered or logged, because tuning isn't practice.
 */
export function useTuningCount(on: boolean, secondsPerCount: number): number {
  const [counts, setCounts] = useState(0);
  const anchor = useRef<Anchor | null>(null);
  const pace = useRef(secondsPerCount);

  useEffect(() => {
    const current = anchor.current;
    if (current) {
      const wall = Date.now();
      anchor.current = { wall, counts: countsAt(current, wall, pace.current) };
    }
    pace.current = secondsPerCount;
  }, [secondsPerCount]);

  useEffect(() => {
    if (!on) {
      anchor.current = null;
      setCounts(0);
      return undefined;
    }
    anchor.current = { wall: Date.now(), counts: 0 };
    setCounts(0);
    const id = setInterval(() => {
      const current = anchor.current;
      if (current) setCounts(countsAt(current, Date.now(), pace.current));
    }, TICK_MS);
    return () => clearInterval(id);
  }, [on]);

  return counts;
}
