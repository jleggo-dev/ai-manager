/**
 * AI Manager — Chat Files
 * =======================
 * Put a document on a chat session's provider ahead of a turn, so the turn can reference it as
 * a `file` content part by id (`SendChatMessageOptions.files`). This is the engine's answer to
 * the request-body ceiling: bytes go to the provider on their own upload call, never inside the
 * JSON that carries the conversation.
 *
 * Session-scoped on purpose — the same provider, key, and credentials resolution the turn itself
 * will use (`resolveSessionClient`), so a personal-key session uploads with the personal key.
 */

import { getChatSession as dbGetSession } from '../models/chat-sessions.ts';
import { getSessionProviderWithKey, resolveSessionClient } from './chat-session-client.ts';

export interface ChatSessionFileUpload {
  buffer: Buffer;
  filename: string;
  mimeType: string;
}

/**
 * Upload one file for a session and return the provider's file id. Throws when the session's
 * provider client cannot take files (Gemini today) or the provider refuses the upload (over its
 * own size ceiling, processing failure) — the caller decides whether that sinks the turn; for the
 * coach it never does (a note tells her the document did not come through).
 */
export async function uploadChatSessionFile(
  sessionId: string,
  file: ChatSessionFileUpload,
): Promise<{ fileId: string }> {
  const session = await dbGetSession(sessionId);
  if (!session) throw new Error(`Chat session ${sessionId} not found`);
  if (session.status !== 'active') throw new Error(`Chat session ${sessionId} is ${session.status}`);

  const provider = await getSessionProviderWithKey(session);
  const client = await resolveSessionClient(session, provider);
  if (typeof client.uploadFile !== 'function') {
    throw new Error(`Provider "${provider.type}" cannot take file attachments`);
  }
  return client.uploadFile(file);
}
