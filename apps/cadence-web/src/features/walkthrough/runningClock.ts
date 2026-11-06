import { useSyncExternalStore } from 'react';
import { expandIntervalPhases, positionAt } from '@cadence/shared';
import { playChime, playTones } from './tools/chime.ts';
import { clockBoundaries, type RunningClockSpec } from './clockBoundaries.ts';
import { formatClock } from './tools/timer.ts';

export type { ClockKind, RunningClockSpec } from './clockBoundaries.ts';

/**
 * The one running clock, held at app level (walkthrough v3 R6, owner 2026-11-03).
 *
 * Every clock tool keeps time by the wall clock, so a clock that was left is caught up on return
 * — but until now the CHIME lived in the tool's render: a timeout armed inside a component that
 * was unmounted when the person switched to the Coach tab never fired, and the interval chime only
 * sounded while the player was on screen (#477's locked-screen check). So a tool now REGISTERS its
 * clock here when it starts, and this module — which lives as long as the page — owns the timeouts
 * that play the chimes at the boundaries (clockBoundaries.ts). Pause, stop and finish unregister;
 * a resume, a skip, a restart or an edit registers again and the boundaries are rescheduled from
 * the new instant. The tool only paints what the store holds.
 *
 * One clock at a time, because one is all a person runs. Registering replaces whatever was there.
 *
 * What the timeouts cannot do: ring while iOS has suspended the webview (the app in the
 * background, the phone locked). Keeping the screen on while a watched clock runs covers the gym
 * floor (useKeepAwakeWhile); for the pocket, a subscriber wired at the app root books the next
 * boundaries as fixed-moment notifications on every registration and cancels them on every
 * release (tools/timerAlarm.ts, `wirePocketBells`). A subscriber rather than a call from here, so
 * this store stays free of the capability layer.
 */

let current: RunningClockSpec | null = null;
let timers: ReturnType<typeof setTimeout>[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((cb) => cb());
}

function clearTimers(): void {
  timers.forEach((id) => clearTimeout(id));
  timers = [];
}

/** Seconds into the run right now — fractional; the tools floor it for the display. */
export function elapsedOf(spec: RunningClockSpec, now = Date.now()): number {
  return spec.base + Math.max(0, now - spec.startedAt) / 1000;
}

function ring(spec: RunningClockSpec, tones: readonly number[] | undefined, vibrateMs: number): void {
  if (current !== spec) return; // replaced or unregistered after this was armed
  if (spec.chime) {
    if (tones) playTones(tones);
    else playChime();
  }
  navigator.vibrate?.(vibrateMs);
}

/** Arm one timeout per boundary still ahead. A boundary at or before this instant is not replayed. */
function schedule(spec: RunningClockSpec): void {
  clearTimers();
  const elapsed = elapsedOf(spec);
  for (const b of clockBoundaries(spec)) {
    const delayMs = (b.atSec - elapsed) * 1000;
    if (delayMs <= 0) continue;
    timers.push(setTimeout(() => ring(spec, b.tones, b.vibrateMs), delayMs));
  }
}

/** A tool's clock started, resumed, or changed (a skip, an edit, the chime switched off). */
export function registerClock(spec: RunningClockSpec): void {
  current = spec;
  schedule(spec);
  emit();
}

/**
 * The clock stopped: a pause, a stop, a finish, the session closed. With a `stepId`, only that
 * step's clock is let go — a tool unmounting for a step whose clock already moved on must not
 * silence the new one.
 */
export function unregisterClock(stepId?: string): void {
  if (!current) return;
  if (stepId !== undefined && current.stepId !== stepId) return;
  current = null;
  clearTimers();
  emit();
}

export function getRunningClock(): RunningClockSpec | null {
  return current;
}

export function subscribeRunningClock(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const none = () => null;

/** The registered clock, or null; re-renders on register and unregister (not on every tick). */
export function useRunningClock(): RunningClockSpec | null {
  return useSyncExternalStore(subscribeRunningClock, getRunningClock, none);
}

/**
 * The clock in one line for the pill: the step and what is left ("Farmer carry · 0:32"), the
 * phase for an interval ("Recover · 0:18"), and past a target the time over ("Ruck · +0:12").
 */
export function clockLine(spec: RunningClockSpec, now = Date.now()): string {
  const elapsed = elapsedOf(spec, now);
  if (spec.kind === 'interval' && spec.plan) {
    const at = positionAt(expandIntervalPhases(spec.plan), elapsed);
    return at.done ? `${spec.title} · done` : `${at.phase.label} · ${formatClock(Math.ceil(at.remaining))}`;
  }
  const left = spec.targetSec - elapsed;
  return left >= 0 ? `${spec.title} · ${formatClock(Math.ceil(left))}` : `${spec.title} · +${formatClock(-left)}`;
}
