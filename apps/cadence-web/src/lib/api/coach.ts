import { BASE, headers } from './http.ts';
import { createCoachSseParseState, pushCoachSseChunk } from './coach-sse.ts';

export async function openCoachSession(
  opts: { intent?: string; topic?: string; systemPrompt?: string } = {},
): Promise<{ sessionId: string }> {
  const res = await fetch(`${BASE}/coach/sessions`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(opts),
  });
  if (!res.ok) throw new Error(`openCoachSession failed: ${res.status}`);
  return res.json();
}

/** The user's current coach session + history (to restore the chat on refresh). `stale` = the
 *  server's freshness verdict (idle >7d, or an onboarding-era thread after the plan committed):
 *  the client should start a fresh thread and not render the old transcript. */
export async function getCurrentCoach(): Promise<{
  sessionId: string | null;
  messages: { role: 'user' | 'coach'; content: string }[];
  stale?: boolean;
  staleReason?: 'idle' | 'graduated' | null;
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
 */
export async function sendCoachMessage(
  sessionId: string,
  message: string,
  onDelta: (text: string) => void,
): Promise<{ completed: boolean; responseId: string | null }> {
  const res = await fetch(`${BASE}/coach/sessions/${sessionId}/messages`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ message }),
  });
  if (!res.body) throw new Error('No stream body');
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const state = createCoachSseParseState();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break; // stream ended without [DONE] → interrupted
    const chunk = decoder.decode(value, { stream: true });
    if (pushCoachSseChunk(state, chunk, onDelta)) return { completed: true, responseId: state.responseId };
  }
  return { completed: false, responseId: state.responseId };
}
