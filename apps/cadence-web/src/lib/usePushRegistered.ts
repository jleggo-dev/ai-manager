import { useCallback, useEffect, useRef } from 'react';
import { capabilities } from './capability/index.ts';
import { enablePushOnThisDevice } from '../features/settings/notifications/enablePush.ts';
import { useAppResume } from './useAppResume.ts';

/**
 * Keep this device registered for notifications. App-wide, from launch, for as long as the app is
 * open — not a feature of any one screen.
 *
 * `cadence.device_tokens` was found EMPTY in production. Not stale — empty. Every push Cadence has
 * ever sent settled as `failed / no_devices`, which is why the owner kept reporting "I never got a
 * notification" across round after round. The cause was scope: the ONLY place that ever asked was
 * the onboarding build screen, so the ask happened once in a person's life, at the single busiest
 * moment of it, and anyone past their first week could never be reached again — no second door,
 * short of finding the Settings toggle.
 *
 * The rule this exists to satisfy (owner, 2026-08-16): *"If I send a chat message to Cadence and I
 * leave the screen: Cadence always keeps running / working on the prompt. Cadence always sends a
 * notification when done. This is true regardless of phase or where I'm chatting."* Core
 * functionality — so registration is core setup, not something a feature opts into.
 *
 * Safe to run on every launch and every resume: iOS shows its system dialog once per install, and
 * every later request resolves straight from the stored answer without surfacing anything. A
 * decline stays declined and silent. Retrying on resume is what catches the case the build screen
 * proved is real — a prompt cannot appear while the app is backgrounded, which is precisely when
 * someone who took us up on "leave the app if you like" would have missed it.
 */
export function usePushRegistered(enabled: boolean): void {
  /** Guards our own listener registration inside `capabilities.push.register`, not the user. */
  const inFlight = useRef(false);
  const done = useRef(false);

  const attempt = useCallback(() => {
    if (!enabled || done.current || inFlight.current || !capabilities.push.isAvailable()) return;
    inFlight.current = true;
    void enablePushOnThisDevice()
      .then((r) => {
        // Only 'on' is final. A denial can be reversed in iOS Settings, and this device may simply
        // have been offline when APNs was asked — both deserve another try next time they return.
        if (r === 'on' || r === 'unavailable') done.current = true;
      })
      .catch(() => undefined)
      .finally(() => {
        inFlight.current = false;
      });
  }, [enabled]);

  useEffect(() => attempt(), [attempt]);
  useAppResume(attempt, enabled);
}
