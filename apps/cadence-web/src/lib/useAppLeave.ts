import { useEffect, useRef } from 'react';
import { App } from '@capacitor/app';

/**
 * Fire when the app goes to the BACKGROUND — the mirror of `useAppResume`.
 *
 * Leaving is a fact only the client knows, and it is the fact the whole notification contract
 * turns on (owner, 2026-08-16: *"If I send a chat message to Cadence and I leave the screen…
 * Cadence always sends a notification when done"*). The server can only infer it, and its
 * inference is wrong in the case that matters most: a socket does not die the instant iOS
 * suspends a webview. Someone who backgrounds the app four seconds into a thirty-second turn can
 * have the reply written to a connection the server still believes is alive, walk away for twenty
 * minutes, and be told nothing — the work survived and no one was told, which is the failure over
 * and over again in a different costume.
 *
 * So the client says so out loud, while it still can. iOS grants a short window after
 * backgrounding in which JavaScript still runs; one small request fits in it easily.
 *
 * Both doors, matching useAppResume: Capacitor's `appStateChange` on iOS, and `visibilitychange`
 * for the web build and tab switches inside the webview. The callback is held in a ref so an
 * inline closure doesn't re-subscribe on every render.
 */
export function useAppLeave(onLeave: () => void, enabled = true): void {
  const cb = useRef(onLeave);
  cb.current = onLeave;

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    const fire = () => {
      if (!disposed) cb.current();
    };

    const onVisibility = () => {
      if (document.hidden) fire();
    };
    document.addEventListener('visibilitychange', onVisibility);

    // Capacitor's listener registration is async; keep the handle so cleanup can't leak one.
    const handle = App.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) fire();
    }).catch(() => null);

    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      void handle.then((h) => h?.remove());
    };
  }, [enabled]);
}
