/* ════════════════════════════════════════════════════════════════
   Step timer tool (REQ8) — pure countdown state machine
   ════════════════════════════════════════════════════════════════ */

/**
 * The walkthrough's first interactive tool: a countdown for a step whose task IS the passage of
 * time — a held plank, a timed meditation — chosen by the coach's `tool: 'timer'` (see
 * @cadence/shared walkthrough.ts; a step with a duration but no timing intent stays a `read`).
 * This module is the PURE state machine (no React, no clock, no audio) so every transition is
 * unit-tested; `useStepTimer` drives it with a real interval and `StepTimer` renders it.
 */

export type TimerStatus = 'ready' | 'running' | 'paused' | 'done';

export interface TimerState {
  total: number; // whole seconds the step is set for
  remaining: number; // whole seconds left
  status: TimerStatus;
}

/** A fresh timer for `totalSeconds` (rounded, floored at 0). A zero-length timer is born `done`. */
export function createTimer(totalSeconds: number): TimerState {
  const total = Math.max(0, Math.round(totalSeconds));
  return { total, remaining: total, status: total === 0 ? 'done' : 'ready' };
}

/** Begin (or resume) counting down. A finished timer stays finished. */
export function start(s: TimerState): TimerState {
  return s.status === 'done' ? s : { ...s, status: 'running' };
}

/** Pause a running timer; a no-op otherwise. */
export function pause(s: TimerState): TimerState {
  return s.status === 'running' ? { ...s, status: 'paused' } : s;
}

/** Back to a fresh, un-started timer of the same length. */
export function reset(s: TimerState): TimerState {
  return createTimer(s.total);
}

/** Advance one second. Only a running timer moves; reaching 0 flips it to `done`. */
export function tick(s: TimerState): TimerState {
  if (s.status !== 'running') return s;
  const remaining = Math.max(0, s.remaining - 1);
  return { ...s, remaining, status: remaining === 0 ? 'done' : 'running' };
}

/** Fraction elapsed, 0..1 (a zero-length timer reads as fully elapsed). */
export function elapsedFraction(s: TimerState): number {
  return s.total === 0 ? 1 : (s.total - s.remaining) / s.total;
}

/** m:ss for a whole-second count ("0:30", "5:00", "12:05"). */
export function formatClock(totalSeconds: number): string {
  const t = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(t / 60);
  const s = t % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
