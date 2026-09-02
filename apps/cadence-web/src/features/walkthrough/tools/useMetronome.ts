import { useCallback, useEffect, useRef, useState } from 'react';
import { type MetronomeSpec, MAX_BPM, MIN_BPM, beatInBar, clampBpm, clampMeter, tapTempo } from '@cadence/shared';
import { createMetronomeClock, type MetronomeClock } from './metronomeAudio.ts';

/**
 * The dock's state: tempo, meter, whether it is running, and where in the bar it is.
 *
 * **Remembering the tempo is keyed on the step's TITLE, not its id.** A step id is `s1`, `s2` —
 * positional, and an `OccurrenceSession` is explicitly "a regenerable cache" that replan wipes and
 * regenerates, so ids move under you and `s1` means a different thing in every task. Keying on the
 * title instead means the tempo you settled on for "Bach Invention 4" is still there next week
 * after the session was rebuilt, and never leaks onto the scales step that happens to be first
 * today. That is the brand promise doing real work: it doesn't make you set it up again.
 */
const KEY_PREFIX = 'cadence.metronome.';

/** Stable, collision-shy key from a step title. */
export function metronomeKey(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  return KEY_PREFIX + (slug || 'step');
}

function remembered(key: string): Partial<MetronomeSpec> | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const v = JSON.parse(raw) as { bpm?: unknown; meter?: unknown };
    const bpm = typeof v.bpm === 'number' ? clampBpm(v.bpm) : undefined;
    const meter = typeof v.meter === 'number' ? clampMeter(v.meter) : undefined;
    return { ...(bpm ? { bpm } : {}), ...(meter ? { meter } : {}) };
  } catch {
    return null; // private mode, cleared storage, a hand-edited value — fall back to the coach's
  }
}

export interface Metronome {
  bpm: number;
  meter: number;
  running: boolean;
  /** 0-based position in the bar; 0 is the downbeat. */
  beat: number;
  /** True once the tempo differs from what the coach prescribed. */
  nudged: boolean;
  setBpm: (bpm: number) => void;
  nudge: (by: number) => void;
  setMeter: (meter: number) => void;
  toggle: () => void;
  tap: () => void;
  reset: () => void;
}

/**
 * Drive the click and own the dock's numbers. `spec` is the coach's prescription; what the person
 * last used on this step (by title) wins over it on open, because they are the one at the piano.
 */
export function useMetronome(spec: MetronomeSpec, title: string, onSettle?: (t: MetronomeSpec) => void): Metronome {
  const key = metronomeKey(title);
  const [bpm, setBpmState] = useState(() => remembered(key)?.bpm ?? spec.bpm);
  const [meter, setMeterState] = useState(() => remembered(key)?.meter ?? spec.meter);
  const [running, setRunning] = useState(false);
  const [beatIndex, setBeatIndex] = useState(0);
  const taps = useRef<number[]>([]);
  const clock = useRef<MetronomeClock | null>(null);
  // A tempo is only "settled" once they did something with it — changed it, or played to it. A
  // step whose dock was never opened must not claim they practise at the number the coach guessed.
  const [engaged, setEngaged] = useState(false);
  const settleRef = useRef(onSettle);
  settleRef.current = onSettle;

  if (!clock.current) clock.current = createMetronomeClock(setBeatIndex);

  // Tempo and meter reach the clock as a plain setter, never by rebuilding it: tearing down the
  // scheduler on every slider pixel would stutter the click, which is the one thing it must not do.
  useEffect(() => {
    clock.current?.setSpec(bpm, meter);
  }, [bpm, meter]);

  useEffect(() => () => clock.current?.dispose(), []);

  // Written on a short delay so dragging the slider doesn't hammer storage on every frame. Local
  // storage is now the OFFLINE COPY, not the record: the piece itself carries the settled tempo
  // (repertoire.meta), which is what survives a new phone and what the coach can actually read.
  // It is still written first and unconditionally — it is the copy that works on a plane.
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        localStorage.setItem(key, JSON.stringify({ bpm, meter }));
      } catch {
        /* storage unavailable — the tempo simply doesn't persist locally */
      }
      if (engaged) settleRef.current?.({ bpm, meter });
    }, 300);
    return () => clearTimeout(id);
  }, [key, bpm, meter, engaged]);

  const setBpm = useCallback((next: number) => {
    setEngaged(true);
    setBpmState(clampBpm(next));
  }, []);
  const nudge = useCallback((by: number) => {
    setEngaged(true);
    setBpmState((b) => clampBpm(b + by));
  }, []);
  const setMeter = useCallback((next: number) => {
    setEngaged(true);
    setMeterState(clampMeter(next));
  }, []);

  const toggle = useCallback(() => {
    setEngaged(true); // playing to it counts as settling on it, even untouched
    setRunning((was) => {
      if (was) clock.current?.stop();
      else {
        setBeatIndex(0);
        clock.current?.start();
      }
      return !was;
    });
  }, []);

  /** Tap the pulse you want. Four taps is the usual gesture; two already gives a tempo. */
  const tap = useCallback(() => {
    setEngaged(true);
    const now = performance.now();
    taps.current = [...taps.current, now].slice(-12);
    const found = tapTempo(taps.current);
    if (found !== null) setBpmState(found);
  }, []);

  const reset = useCallback(() => {
    setEngaged(true); // deliberately going back to her tempo is itself a decision worth keeping
    taps.current = [];
    setBpmState(spec.bpm);
    setMeterState(spec.meter);
  }, [spec.bpm, spec.meter]);

  return {
    bpm,
    meter,
    running,
    beat: beatInBar(beatIndex, meter),
    nudged: bpm !== spec.bpm || meter !== spec.meter,
    setBpm,
    nudge,
    setMeter,
    toggle,
    tap,
    reset,
  };
}

export { MAX_BPM, MIN_BPM };
