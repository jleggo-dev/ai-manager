/**
 * One short tick — the hold on a quick-log tile landing (2026-10-28). Capacitor Haptics on the
 * phone, `navigator.vibrate` on the web (Android browsers; Safari has none and stays silent).
 * Never throws and never awaits anything a gesture should wait on: a missing haptic is not an
 * error, it is a phone without one.
 */
import { Capacitor } from '@capacitor/core';
import { Haptics, ImpactStyle } from '@capacitor/haptics';

export function tickHaptic(): void {
  try {
    if (Capacitor.isNativePlatform()) {
      void Haptics.impact({ style: ImpactStyle.Medium }).catch(() => undefined);
      return;
    }
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') navigator.vibrate(12);
  } catch {
    /* no haptics here */
  }
}
