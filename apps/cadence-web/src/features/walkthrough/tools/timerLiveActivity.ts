import { capabilities } from '../../../lib/capability/index.ts';

/**
 * The timer on the lock screen.
 *
 * A Live Activity is the only surface iOS offers for a clock that keeps showing while the phone
 * is in a pocket — the webview is asleep, and a notification is a moment, not a clock. The
 * activity draws itself off INSTANTS (when the run began, how much was done before it, when the
 * target lands), so once started it needs nothing further from the app until the person touches
 * the timer again: pause, resume, or stop.
 *
 * Fire-and-forget on purpose, like the alarm: a timer must never wait on ActivityKit, and a
 * failure to show costs the lock-screen clock, not the timer. On the web there is no such
 * surface and every call is a no-op.
 */
const live = () => (capabilities.liveActivity.isAvailable() ? capabilities.liveActivity : null);

export function startTimerActivity(title: string, targetSeconds: number, startedAt: number, baseSeconds: number): void {
  void live()
    ?.start({ title, targetSeconds, startedAt, baseSeconds })
    .catch(() => undefined);
}

export function pauseTimerActivity(baseSeconds: number): void {
  void live()
    ?.pause(baseSeconds)
    .catch(() => undefined);
}

export function endTimerActivity(): void {
  void live()
    ?.end()
    .catch(() => undefined);
}
