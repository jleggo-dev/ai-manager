import { capabilities } from '../../../lib/capability/index.ts';

/**
 * The timer's bell for when the app is not awake to ring it.
 *
 * WebAudio plays only while the webview runs; a phone in a pocket with a podcast on is a webview
 * that has been suspended. So when a timer starts (or resumes) it books a local notification for
 * the instant it will reach its target, and cancels it on pause, stop, reset or unmount. On the
 * web there is nothing to book and the call reports so; the in-page chime still sounds if the tab
 * is awake at the moment, which is the most any browser allows.
 *
 * Fire-and-forget on purpose: a timer must never wait on the notification centre, and a failure
 * to book costs the pocket bell, not the timer.
 */
export function bookTimerAlarm(at: number, title: string, targetLabel: string): void {
  if (!capabilities.localNotifications.isAvailable()) return;
  void capabilities.localNotifications
    .scheduleAlarm({ at, title, body: `${targetLabel} is up — keep going or stop the clock.` })
    .catch(() => undefined);
}

export function cancelTimerAlarm(): void {
  if (!capabilities.localNotifications.isAvailable()) return;
  void capabilities.localNotifications.cancelAlarm().catch(() => undefined);
}
