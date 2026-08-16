import { BASE, headers } from './http.ts';
import { createCoachSseParseState, pushCoachSseChunk } from './coach-sse.ts';

export async function openCoachSession(
  opts: {
    intent?: string;
    topic?: string;
    systemPrompt?: string;
    /** Does this device have Apple Health at all. */
    healthAvailable?: boolean;
    /** Have we already offered it once (so she should not offer again unprompted). */
    healthAnswered?: boolean;
  } = {},
): Promise<{ sessionId: string }> {
  const res = await fetch(`${BASE}/coach/sessions`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(opts),
  });
  if (!res.ok) throw new Error(`openCoachSession failed: ${res.status}`);
  return res.json();
}

/**
 * End the in-flight reply upstream. Called alongside aborting the local read, because the server
 * deliberately keeps draining a dropped stream (so a phone that loses signal never loses a reply)
 * — without this, "stop" would only stop the listening.
 *
 * Soft-fails by design: the composer is already back in the user's hands, so a failure here costs
 * a wasted generation rather than a broken screen.
 */
export async function stopCoachTurn(sessionId: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/coach/sessions/${sessionId}/stop`, { method: 'POST', headers: headers() });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * "I'm going to background — notify me when she's done."
 *
 * Sent as the app leaves with a turn still streaming, inside the short window iOS keeps
 * JavaScript alive for. It exists because the server cannot tell: a suspended webview's socket
 * can stay open, so the reply lands on a connection nobody is reading and the turn looks watched.
 * Leaving is a fact only the client has.
 *
 * `keepalive` is what makes it work at all — a normal fetch is abandoned when the page is
 * hidden/torn down, which is precisely the moment this is sent. Soft-fails: the cost is a missing
 * notification, never the reply, and there is nobody on screen to tell.
 */
export async function notifyOnCoachReply(sessionId: string | null): Promise<boolean> {
  if (!sessionId) return false; // nothing open to be notified about
  try {
    const res = await fetch(`${BASE}/coach/sessions/${sessionId}/notify-on-reply`, {
      method: 'POST',
      headers: headers(),
      keepalive: true,
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** The user's current coach session + history (to restore the chat on refresh). `stale` = the
 *  server's freshness verdict (idle >7d, or an onboarding-era thread after the plan committed):
 *  the client should start a fresh thread and not render the old transcript. */
export async function getCurrentCoach(): Promise<{
  sessionId: string | null;
  messages: { role: 'user' | 'coach'; content: string }[];
  stale?: boolean;
  staleReason?: 'idle' | 'graduated' | null;
  /** A reply is still being written server-side — keep waiting, don't declare a drop. */
  generating?: boolean;
}> {
  const res = await fetch(`${BASE}/coach/current`, { headers: headers() });
  if (!res.ok) return { sessionId: null, messages: [] };
  return res.json();
}

/**
 * Send a message; calls onDelta as SSE chunks arrive. Resolves with `completed:true` when a
 * clean `[DONE]` is seen. If the stream ends WITHOUT `[DONE]` (a dropped connection mid-turn),
 * resolves with `completed:false` so the caller can recover the durably-persisted reply from
 * GET /coach/current. 409-safe: disable send until resolved.
 *
 * `signal` lets the caller stop listening — the Stop button's local half. The other half is
 * `stopCoachTurn`, which actually ends the generation upstream; aborting alone would leave the
 * reply running, billed in full, and reappearing whole on the next restore.
 */
export async function sendCoachMessage(
  sessionId: string,
  message: string,
  onDelta: (text: string) => void,
  signal?: AbortSignal,
  /** Called when she has just run a tool, so the screen can say what is happening. */
  onActivity?: (names: string[]) => void,
): Promise<{ completed: boolean; responseId: string | null }> {
  const res = await fetch(`${BASE}/coach/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ message }),
    signal,
  });
  if (!res.body) throw new Error('No stream body');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const state = createCoachSseParseState();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break; // stream ended without [DONE] → interrupted
    const chunk = decoder.decode(value, { stream: true });
    if (pushCoachSseChunk(state, chunk, onDelta, onActivity)) return { completed: true, responseId: state.responseId };
  }
  return { completed: false, responseId: state.responseId };
}
