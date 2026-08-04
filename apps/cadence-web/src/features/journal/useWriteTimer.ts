import { useCallback, useEffect, useRef, useState } from 'react';

/** One second is plenty: the hairline moves in a 3px track and the chip shows mm:ss. */
const TICK_MS = 1000;

export interface WriteTimer {
  /** Seconds counted so far, excluding time spent backgrounded. */
  elapsedSec: number;
  /** Milliseconds since the last keystroke — the idle nudge's input. */
  idleMs: number;
  /** True once the clock has run out. Latches: it never flips back. */
  done: boolean;
  /** Call on every keystroke to reset the idle window. */
  poke: () => void;
  /** Abandon the clock — "Keep writing" continues the entry with no timer at all. */
  stop: () => void;
}

/**
 * The free-write clock (Design "Journal v2" §1b). Accumulates elapsed time across pauses rather
 * than measuring from a single start, because **backgrounding pauses the timer and it resumes on
 * return** — someone who takes a phone call has not spent that call writing, and charging them for
 * it would turn a companion into an invigilator.
 *
 * Two deliberate absences:
 *
 *   • **No pause control.** Design's redline is that pausing is never punished, and the honest way
 *     to honour that is to not make pausing a thing you do — leaving the app is the pause, and
 *     saving early is an ordinary save.
 *   • **No overtime.** `done` latches at zero and the caller drops the timer entirely; writing past
 *     the end is free and uncounted, so there is nothing here that could count it.
 *
 * `onDone` fires exactly once — guarded by the same latch — so the chime can't repeat if React
 * re-renders or the tab regains focus after the end.
 */
export function useWriteTimer(totalSec: number, running: boolean, onDone: () => void): WriteTimer {
  const [elapsedSec, setElapsedSec] = useState(0);
  const [idleMs, setIdleMs] = useState(0);
  const [done, setDone] = useState(false);

  // Wall-clock anchor for the CURRENT run; `banked` holds whole seconds from previous runs, so a
  // background/foreground cycle resumes where it left off instead of restarting or skipping ahead.
  const runStart = useRef<number | null>(null);
  const banked = useRef(0);
  const lastKey = useRef(Date.now());
  const fired = useRef(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const poke = useCallback(() => {
    lastKey.current = Date.now();
    setIdleMs(0);
  }, []);

  const stop = useCallback(() => {
    runStart.current = null;
    banked.current = 0;
    setElapsedSec(0);
    setDone(false);
    fired.current = false;
  }, []);

  useEffect(() => {
    if (!running || done) return undefined;

    const resume = () => {
      if (runStart.current === null) runStart.current = Date.now();
    };
    const pause = () => {
      if (runStart.current !== null) {
        banked.current += (Date.now() - runStart.current) / 1000;
        runStart.current = null;
      }
    };
    // The tab going hidden banks what's been counted; coming back re-anchors. Without this a phone
    // call would eat someone's whole session while the page slept.
    const onVisibility = () => (document.hidden ? pause() : resume());

    resume();
    document.addEventListener('visibilitychange', onVisibility);
    const id = setInterval(() => {
      const live = runStart.current === null ? 0 : (Date.now() - runStart.current) / 1000;
      const total = banked.current + live;
      setElapsedSec(total);
      setIdleMs(Date.now() - lastKey.current);
      if (total >= totalSec && !fired.current) {
        fired.current = true;
        setDone(true);
        onDoneRef.current();
      }
    }, TICK_MS);

    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisibility);
      pause();
    };
  }, [running, done, totalSec]);

  return { elapsedSec, idleMs, done, poke, stop };
}
