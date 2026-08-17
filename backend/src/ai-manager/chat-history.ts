/**
 * One definition of "the conversation so far".
 *
 * The send path and the tool-result continuation must reconstruct the SAME thing, or the model
 * answers round two with less than it had on round one. They didn't, and that was the bug
 * (#232): a continuation shipped `previous_response_id` plus the function results and nothing
 * else, so the request lost the dossier, the system prompt and every prior turn.
 */
import { buildCompactedHistory, getSummarizerConfig } from '../services/session-compaction.ts';
import { listChatMessages } from '../models/chat-sessions.ts';
import type { ChatMessage, ChatSessionRow } from '../types.ts';

/**
 * The session's messages, compacted, in provider-neutral `ChatMessage` shape.
 *
 * The session's system prompt (Cadence's per-user dossier) is a stored `system` row written at
 * session open — see chat-session-lifecycle.ts — so it rides in here rather than being threaded
 * in separately. `messagesToV2Request` lifts it back out into v2 `instructions`.
 */
export async function buildSessionChatMessages(sessionId: string, session: ChatSessionRow): Promise<ChatMessage[]> {
  const raw = await listChatMessages(sessionId);
  return buildCompactedHistory(session, raw, getSummarizerConfig(session)).map((m) => ({
    role: m.role as 'system' | 'user' | 'assistant',
    content: m.content,
  }));
}
