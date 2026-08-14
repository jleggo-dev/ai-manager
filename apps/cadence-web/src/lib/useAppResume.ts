import { useEffect, useRef } from 'react';
import { App } from '@capacitor/app';

/**
 * Fire when the app comes back to the foreground.
 *
 * The missing half of leave-safety. Everything the app does to survive being left — the relay
 * draining server-side, the build running to completion, the recovery poll — only helps if
 * SOMETHING notices you came back. Nothing did: recovery ran only when a dead fetch got around
 * to rejecting, and iOS can leave a fetch that died during suspension unsettled for a long
 * time, or forever. So the app sat on a spinner (or an error) while the finished reply was
 * already on file, a phone-tap away.
 *
 * Both doors, because the app runs in both places: Capacitor's `appStateChange` on iOS, and
 * `visibilitychange` for the web build and for tab switches inside the webview.
 *
 * The callback is held in a ref so a caller can pass an inline closure without re-subscribing
 * on every render — these listeners outlive renders and double-subscribing would double-heal.
 */
export function useAppResume(onResume: () => void, enabled = true): void {
  const cb = useRef(onResume);
  cb.current = onResume;

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    const fire = () => {
      if (!disposed) cb.current();
    };

    const onVisibility = () => {
      if (!document.hidden) fire();
    };
    document.addEventListener('visibilitychange', onVisibility);

    // Capacitor's listener registration is async; keep the handle so cleanup can't leak one.
    const handle = App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) fire();
    }).catch(() => null);

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      void handle.then((h) => h?.remove());
    };
  }, [enabled]);
}
