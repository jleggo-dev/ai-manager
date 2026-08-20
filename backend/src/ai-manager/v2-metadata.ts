/**
 * v2 threading metadata on a chat session — its own module because BOTH halves of the send path
 * need it: chat-messaging.ts persists it after tool continuations and chat-messaging-stream.ts
 * captures/clears it around the main stream. Living in either would make the two import each
 * other, and this codebase has already paid for that shape once (nutrition-facade.ts records the
 * boot-order outage: every test passed because vitest resolved the cycle in the lucky order).
 */
import { getChatSession as dbGetSession, updateChatSession as dbUpdateSession } from '../models/chat-sessions.ts';

/** Persist v2 threading metadata on a chat session after a completed response. */
export async function updateV2ProviderMetadata(
  sessionId: string,
  patch: {
    /** A new id to anchor on, or `null` to CLEAR the anchor (thread-mode's stateless fallback). */
    previous_response_id?: string | null;
    conversation_id?: string;
    last_sequence?: number;
  },
): Promise<void> {
  const session = await dbGetSession(sessionId);
  if (!session) return;
  const current = (session.provider_metadata || {}) as Record<string, unknown>;
  const next: Record<string, unknown> = { ...current };
  if (patch.previous_response_id) next.previous_response_id = patch.previous_response_id;
  else if (patch.previous_response_id === null) delete next.previous_response_id;
  if (patch.conversation_id) next.conversation_id = patch.conversation_id;
  if (patch.last_sequence != null) next.last_sequence = patch.last_sequence;
  await dbUpdateSession(sessionId, { provider_metadata: next });
}
