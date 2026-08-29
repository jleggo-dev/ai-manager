import { useEffect, useRef } from 'react';
import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';

/**
 * Run a callback every time the app comes back to the foreground.
 *
 * Exists because nothing did (2026-08-29 device round): backgrounding the app mid-boot left the
 * gate's fetch on a dead socket and NOTHING listened for the return — no `appStateChange`
 * listener anywhere, `refetchOnWindowFocus` deliberately off — so the skeleton sat for minutes
 * with a rescuer never coming. This is that rescuer's doorbell, and only the doorbell: what to
 * do on resume stays with the caller.
 *
 * On the native shell the signal is Capacitor's `appStateChange` — the webview's own
 * `visibilitychange` is not reliably delivered across an iOS suspend. On the web it IS the
 * signal. Both are wired; the callback is deduped by a same-tick guard so a platform that fires
 * both delivers one resume, not two.
 */
export function useForegroundResume(onResume: () => void): void {
  const cb = useRef(onResume);
  cb.current = onResume;

  useEffect(() => {
    let last = 0;
    const fire = () => {
      const now = Date.now();
      if (now - last < 500) return; // both signals in one return = one resume
      last = now;
      cb.current();
    };

    const onVisible = () => {
      if (document.visibilityState === 'visible') fire();
    };
    document.addEventListener('visibilitychange', onVisible);

    let remove: (() => void) | undefined;
    if (Capacitor.isNativePlatform()) {
      const p = App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) fire();
      });
      p.then((h) => {
        remove = () => void h.remove();
      }).catch(() => undefined);
    }

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      remove?.();
    };
  }, []);
}
