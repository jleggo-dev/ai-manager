/**
 * What a failed read, answer or add says, and what the person can do next (owner, 2026-11-02:
 * "these small messages are almost impossible to see and there's no indication of what the user
 * can do about it or why… did we lose connection to the internet? What's happening?").
 *
 * One table for every door — the "What did you have?" sheet, the chat door, the meal drawer —
 * so the same failure never reads two ways, and table-tested (failureWords.test.ts) because the
 * branch is a router: the wrong line sends someone to retry a request the server will refuse
 * again. The line says what happened in plain words, that nothing typed was lost, and the next
 * step. The coach speaks as "I" (BRAND.md).
 *
 * How a failure is told apart:
 *   - offline: the browser says so, or fetch itself threw (a TypeError — "Failed to fetch",
 *     "Load failed" — is the network, never the server);
 *   - timed out: the fetch's own timeout signal (lib/api/http.ts) fired;
 *   - refused (400): the server would refuse the same words again, so "try again" is wrong;
 *   - signed out (401/403), gone (404: the meal is no longer open);
 *   - anything else is our side, and a retry is the right next step.
 */

/** What was being done when it failed. */
export type FailedAct = 'read' | 'answer' | 'add';

export interface FailureWords {
  /** The line, in full sentences. */
  line: string;
  /** Whether trying the same thing again could work (false when the server would refuse it again, or the person is signed out). */
  retry: boolean;
}

const KEPT = 'Your words are kept here.';
const NOTHING_LOST = 'Nothing was lost.';

/** The generic line for an add that failed on our side; the drawer's own line since the rework. */
export const ADD_FAILED = `Something went wrong on my side writing that down. ${NOTHING_LOST} Try again in a moment.`;

function isOffline(err: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  // fetch rejects with a TypeError when the request never reached a server.
  return err instanceof TypeError;
}

function isTimeout(err: unknown): boolean {
  const name = (err as { name?: unknown } | null)?.name;
  return name === 'TimeoutError' || name === 'AbortError';
}

function statusOf(err: unknown): number | null {
  const s = (err as { status?: unknown } | null)?.status;
  return typeof s === 'number' ? s : null;
}

export function failureWords(err: unknown, act: FailedAct): FailureWords {
  const read = act !== 'add';
  if (isOffline(err)) {
    return {
      line: read
        ? `You're offline, so I couldn't look that up. ${KEPT} Try again when you're back on.`
        : `You're offline, so that didn't reach your meal. ${NOTHING_LOST} Try again when you're back on.`,
      retry: true,
    };
  }
  if (isTimeout(err)) {
    return {
      line: read
        ? `That took too long and I stopped waiting. ${KEPT} Try again, or name fewer foods at once.`
        : `That took too long and I stopped waiting. ${NOTHING_LOST} Try again.`,
      retry: true,
    };
  }
  const status = statusOf(err);
  if (status === 400) {
    return {
      line: read
        ? "I couldn't take that as written. Try plainer words, or fewer foods at once."
        : 'Your meal would not take one of those rows as written. Drop the row that looks odd and try again.',
      retry: false,
    };
  }
  if (status === 401 || status === 403) {
    return { line: "You're signed out. Sign in again and I'll pick this up where you left it.", retry: false };
  }
  if (status === 404 && !read) {
    return { line: "That meal isn't open any more. Close this and open the meal again.", retry: false };
  }
  return {
    line: read ? `Something went wrong on my side looking that up. ${KEPT} Try again in a moment.` : ADD_FAILED,
    retry: true,
  };
}
