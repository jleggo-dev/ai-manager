import { BOUNDARY_ALARM_COUNT, capabilities, type TimerAlarm } from '../../../lib/capability/index.ts';
import { clockBoundaries, type RunningClockSpec } from '../clockBoundaries.ts';
import { getRunningClock, subscribeRunningClock } from '../runningClock.ts';

/**
 * The pocket tier (walkthrough v3 Phase 7c, R6): the running clock's next boundaries, booked as
 * fixed-moment local notifications so the OS rings them while the webview is asleep.
 *
 * WebAudio plays only while the webview runs; a phone in a pocket, or locked by hand, is a
 * webview that has been suspended, and the store's timeouts (runningClock.ts) do not fire. So
 * whenever a clock is registered — start, resume, skip, restart, edit — the next
 * `BOUNDARY_ALARM_COUNT` boundaries still ahead of it are booked from the same list the store
 * chimes from (clockBoundaries.ts): work / recover / done for an interval, the target for a timer
 * or a timed set, the halfway chime for switch-sides, the bells and the end for a sit. Pause,
 * stop, finish and the session closing cancel them all. On the web there is nothing to book and
 * the call reports so; the in-page chime still sounds if the tab is awake at the moment.
 *
 * The 64-slot budget. iOS holds at most 64 pending local notifications per app, shared with the
 * plan reminders (lib/local-notifications-sync.ts). A reminder is one repeating weekly
 * notification per (activity, weekday) — a full week of daily reminders across the nudge kinds
 * stays in the low tens — and this feature never holds more than BOUNDARY_ALARM_COUNT (8) at
 * once, booked into its own reserved ids (BOUNDARY_ALARM_IDS, above every reminder hash), so the
 * two never collide and the reminder sync never cancels a booked boundary. An interval can have
 * up to 4 sets × 20 rounds × 2 phases, far past the budget; booking only the next eight, and
 * rebooking on every change, keeps the pocket ringing for the next few minutes at a cost of
 * eight slots, never the whole run.
 *
 * Fire-and-forget on purpose: a clock must never wait on the notification centre, and a failure
 * to book costs the pocket bell, not the clock.
 *
 * Wired once at the app root (`wirePocketBells`, main.tsx) as a subscriber of the clock store,
 * rather than called from inside it, so the store stays free of the capability layer.
 */

/** The next `limit` boundaries after `now`, as alarms: the step's title, the boundary in plain words. */
export function pendingBoundaries(
  spec: RunningClockSpec,
  now = Date.now(),
  limit = BOUNDARY_ALARM_COUNT,
): TimerAlarm[] {
  const elapsed = spec.base + Math.max(0, now - spec.startedAt) / 1000;
  return clockBoundaries(spec)
    .filter((b) => b.atSec > elapsed)
    .slice(0, limit)
    .map((b) => ({
      at: spec.startedAt + (b.atSec - spec.base) * 1000,
      title: spec.title,
      body: b.seconds != null ? `${b.label} · ${b.seconds} s` : b.label,
    }));
}

export function bookBoundaries(spec: RunningClockSpec, now = Date.now()): void {
  if (!capabilities.localNotifications.isAvailable()) return;
  void capabilities.localNotifications.scheduleAlarms(pendingBoundaries(spec, now)).catch(() => undefined);
}

export function cancelBoundaries(): void {
  if (!capabilities.localNotifications.isAvailable()) return;
  void capabilities.localNotifications.cancelAlarms().catch(() => undefined);
}

/** Follow the running clock: book on every registration, cancel on every release. Returns the unwire. */
export function wirePocketBells(): () => void {
  return subscribeRunningClock(() => {
    const clock = getRunningClock();
    if (clock) bookBoundaries(clock);
    else cancelBoundaries();
  });
}
