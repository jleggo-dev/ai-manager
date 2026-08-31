import { useEffect } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { useQueryClient } from '@tanstack/react-query';
import { postWatchLog } from '../api.ts';
import { capabilities, type WatchPendingLog } from '../capability/index.ts';
import { queryKeys } from './keys.ts';

/**
 * Deliver sessions finished on the watch to the API (watch app W2 — the return leg).
 *
 * The phone holds received logs in an outbox because WatchConnectivity delivers to the native app,
 * which can receive one while the webview is not running at all. This drains that outbox on mount,
 * and again whenever a log arrives live.
 *
 * **A log is acknowledged only once the server has it.** Anything unacknowledged is delivered
 * again on the next drain, so an app killed mid-POST retries rather than losing what somebody did.
 * The one thing dropped deliberately is a payload the server rejects as malformed: that will fail
 * identically forever, and leaving it queued would block every log behind it.
 */
export async function drainWatchLogs(queryClient: QueryClient): Promise<number> {
  if (!capabilities.watchSync.isAvailable()) return 0;

  const pending: WatchPendingLog[] = await capabilities.watchSync.pendingLogs();
  if (!pending.length) return 0;

  const settled: string[] = [];
  let stored = 0;
  for (const log of pending) {
    if (log.payload === null) {
      // Unparseable on the way out of the plugin — acknowledge so it stops being redelivered.
      settled.push(log.id);
      continue;
    }
    const { stored: ok, rejected } = await postWatchLog(log.payload);
    if (ok) {
      stored += 1;
      settled.push(log.id);
    } else if (rejected) {
      settled.push(log.id);
    }
    // Neither stored nor rejected = a transport failure. Left in the outbox for the next drain.
  }

  await capabilities.watchSync.ackLogs(settled);

  // A stored log marks its occurrence done, so the week on screen is now stale. Invalidating also
  // re-runs the push, which is how the watch learns its own session was accepted.
  if (stored > 0) await queryClient.invalidateQueries({ queryKey: queryKeys.plan.all });
  return stored;
}

export function useWatchLogInbox(): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!capabilities.watchSync.isAvailable()) return;

    let cancelled = false;
    const drain = () => {
      if (cancelled) return;
      void drainWatchLogs(queryClient);
    };

    // Once on mount, for anything that landed while the app was closed.
    drain();
    // And on every live arrival, so a session logged with the phone in a pocket lands at once.
    const unsubscribe = capabilities.watchSync.onLogReceived(drain);

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [queryClient]);
}
