import type { WatchWeekPayload } from '@cadence/shared';
import { BASE, headers, timeoutSignal } from './http.ts';

/**
 * The committed week, already projected for the wrist by the server (`buildWatchWeek`).
 *
 * The phone forwards this to the watch verbatim — it neither builds nor edits the payload, so
 * there is exactly one place the projection can be wrong and it has tests. `null` on any failure:
 * a sync that cannot fetch simply does not happen, and the wrist keeps the week it already had,
 * which is a better answer than replacing a good week with an empty one.
 */
export async function getWatchWeek(): Promise<WatchWeekPayload | null> {
  try {
    const res = await fetch(`${BASE}/plan/watch`, {
      headers: headers(),
      signal: timeoutSignal(15_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as WatchWeekPayload;
  } catch {
    return null;
  }
}

/**
 * Send a session finished on the watch.
 *
 * Answers whether the server stored it. `false` means the caller must NOT acknowledge the log to
 * the phone — it stays in the outbox and is retried, so a session somebody did is never lost to a
 * dropped connection. A 400 is the one exception the caller handles separately: a payload the
 * server refuses as malformed will be refused every time, and retrying it forever would block the
 * queue behind it.
 */
export async function postWatchLog(payload: unknown): Promise<{ stored: boolean; rejected: boolean }> {
  try {
    const res = await fetch(`${BASE}/plan/watch/log`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(payload),
      signal: timeoutSignal(15_000),
    });
    // 400 = this will never succeed (not a log, or not our occurrence). Drop it rather than
    // retrying a poison row past everything queued behind it.
    if (res.status === 400 || res.status === 404) return { stored: false, rejected: true };
    return { stored: res.ok, rejected: false };
  } catch {
    return { stored: false, rejected: false };
  }
}
