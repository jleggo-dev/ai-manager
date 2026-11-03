import { App } from '@capacitor/app';

/**
 * Be told when the app comes back to the foreground — the plain-function half of `useAppResume`,
 * for code that is not a component: a request in flight (lib/api/kept-answers.ts) has no render
 * to hang a hook on, and it is exactly the thing that needs to know.
 *
 * Both doors, because the app runs in both places: Capacitor's `appStateChange` on iOS (the
 * webview's own `visibilitychange` is not reliably delivered across a suspend), and
 * `visibilitychange` for the web build and tab switches inside the webview. A platform that fires
 * both delivers two calls; callers that must act once guard for it.
 *
 * Returns the function that stops listening. Capacitor's registration is async, so the handle is
 * kept as a promise and removed when it lands — a listener can never leak past its caller.
 */
export function onAppResume(cb: () => void): () => void {
  // No document, nothing to come back to: the API's client↔route tests run this client in Node.
  if (typeof document === 'undefined') return () => {};
  let disposed = false;
  const fire = () => {
    if (!disposed) cb();
  };

  const onVisibility = () => {
    if (!document.hidden) fire();
  };
  document.addEventListener('visibilitychange', onVisibility);

  const handle = listenNative(() => fire());

  return () => {
    disposed = true;
    document.removeEventListener('visibilitychange', onVisibility);
    void handle.then((h) => h?.remove());
  };
}

/** Capacitor's door, guarded: a shell without the plugin must cost the caller nothing. */
function listenNative(onActive: () => void): Promise<{ remove: () => void | Promise<void> } | null> {
  try {
    return App.addListener('appStateChange', ({ isActive }) => {
      if (isActive) onActive();
    }).catch(() => null);
  } catch {
    return Promise.resolve(null);
  }
}
