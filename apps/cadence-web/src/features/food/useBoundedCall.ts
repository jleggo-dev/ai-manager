import { useCallback, useEffect, useRef } from 'react';

/**
 * One call in flight at a time, each with its own token, bounded and abortable — the photo door's
 * discipline (useMealPhotoRead), kept apart so the hook that narrates the read stays under its
 * size gate.
 *
 * Each call holds its own token; only the CURRENT call may set what the screen shows or clear the
 * timer. Without it a superseded call's abort landed as "took too long" over the new call's
 * phase, and its `finally` cleared the new call's timer (review of #457, round 2). Leaving
 * (`cancel`) abandons whatever is in flight, and nothing it returns is shown.
 */
export function useBoundedCall() {
  const seq = useRef(0);
  const inFlight = useRef<{ token: number; ctrl: AbortController; timer: ReturnType<typeof setTimeout> } | null>(null);

  /** Drop whatever is in flight: its abort is its own business, nothing it does reaches the screen. */
  const dropInFlight = useCallback((reason: string) => {
    const prior = inFlight.current;
    if (!prior) return;
    inFlight.current = null;
    clearTimeout(prior.timer);
    prior.ctrl.abort(new DOMException(reason, 'AbortError'));
  }, []);

  /** A bounded call with its own token: its signal aborts at the bound, or when it is superseded or left. */
  const begin = useCallback(
    (bound: number): { signal: AbortSignal; token: number } => {
      dropInFlight('superseded');
      const token = ++seq.current;
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(new DOMException('took too long', 'TimeoutError')), bound);
      inFlight.current = { token, ctrl, timer };
      return { signal: ctrl.signal, token };
    },
    [dropInFlight],
  );

  /** True while this call is still the one the screen is waiting on. */
  const current = useCallback((token: number): boolean => token === seq.current, []);

  const end = useCallback((token: number) => {
    if (inFlight.current?.token !== token) return;
    clearTimeout(inFlight.current.timer);
    inFlight.current = null;
  }, []);

  /** Leaving: whatever is in flight is abandoned, and nothing it returns is shown. */
  const cancel = useCallback(() => {
    seq.current += 1;
    dropInFlight('left');
  }, [dropInFlight]);
  useEffect(() => () => cancel(), [cancel]);

  return { begin, end, current, cancel };
}
