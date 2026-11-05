import { useMemo } from 'react';
import { useRunningClock, type ClockKind, type RunningClockSpec } from './runningClock.ts';
import { useKeepAwakeWhile } from './tools/useKeepAwakeWhile.ts';
import { readSitScreen, type SitScreen } from '../../lib/sit-screen.ts';

/** The clocks a person watches: the screen stays on for these whatever the phone's settings. */
const WATCHED: ReadonlySet<ClockKind> = new Set(['timer', 'timed_set', 'interval', 'circuit_move']);

/**
 * Whether a registered clock holds the screen: always for a watched clock (walkthrough v3 R6);
 * for a sit and the breath pacer only when this phone's "Screen during a sit" says so — keep-awake
 * means a lit screen, and a sit is eyes-closed (owner, 2026-11-03).
 */
export function clockHoldsScreen(clock: RunningClockSpec | null, sitScreen: SitScreen): boolean {
  if (!clock) return false;
  return WATCHED.has(clock.kind) || sitScreen === 'on';
}

/**
 * The screen stays on while a clock you watch runs — held from the app root, following the
 * running-clock store, not from inside the tool. The clock outlives the tool: start a timer and
 * switch to the Coach tab, and the tool unmounts while the clock keeps running. A hold released
 * on that unmount would let the phone auto-lock, suspend the webview, and silence the chime the
 * store armed — the gym-floor case R6 exists for. So the hold lives beside the pill, for the life
 * of the shell: taken when a clock registers, released when it unregisters. The pre-roll before a
 * clock starts is not a running clock; a few seconds unheld there is fine.
 */
export function useClockKeepAwake(): void {
  const clock = useRunningClock();
  const held = useMemo(() => clockHoldsScreen(clock, readSitScreen()), [clock]);
  useKeepAwakeWhile(held);
}
