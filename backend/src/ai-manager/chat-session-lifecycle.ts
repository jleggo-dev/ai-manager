/**
 * AI Manager — Chat Session Lifecycle
 * =====================================
 * Close / reset / delete chat sessions, history and files, assistant-message persistence, and
 * the compliance remote-chat purge. Open + resume were split out 2026-08-04
 * (chat-session-open.ts / chat-session-resume.ts) and are re-exported below, so THIS module's
 * import surface is unchanged — the stable seam every consumer already uses.
 */
import { DevsAiClient } from '../integrations/devs-ai/client.ts';
import { tenantFrom } from '../db/tenant.ts';
import {
  getChatSession as dbGetSession,
  updateChatSession as dbUpdateSession,
  deleteChatSession as dbDeleteSession,
  createChatMessage,
  listChatMessages,
  deleteChatMessages,
  incrementSessionCounters,
} from '../models/chat-sessions.ts';
import { errorMessage } from '../lib/error-message.ts';
import type { ChatMessageRow, ChatSessionRow } from '../types.ts';
import { getSessionProviderWithKey, resolveSessionClient, getCompletedWorkflowSteps } from './chat-session-client.ts';

/* Re-export the split pieces + leaf helpers so existing imports from this module stay stable. */
export { getSessionProviderWithKey, resolveSessionClient, getCompletedWorkflowSteps };
export { openChatSession } from './chat-session-open.ts';
export type { OpenChatSessionOptions, OpenChatSessionResult, JobConfig } from './chat-session-open.ts';
export { resumeChatSession } from './chat-session-resume.ts';
export type { ResumeChatSessionOptions, ResumeChatSessionResult } from './chat-session-resume.ts';

interface RecordMetrics {
  promptTokens?: number | null;
  completionTokens?: number | null;
  durationMs?: number | null;
  firstTokenMs?: number | null;
}

/**
 * Record the assistant's completed reply after streaming finishes.
 * Called by the route handler after the SSE stream is fully consumed.
 */
export async function recordAssistantMessage(
  sessionId: string,
  content: string,
  metrics: RecordMetrics = {},
): Promise<ChatMessageRow> {
  const msg = await createChatMessage({
    chat_session_id: sessionId,
    role: 'assistant',
    content,
    prompt_tokens: metrics.promptTokens || null,
    completion_tokens: metrics.completionTokens || null,
    duration_ms: metrics.durationMs || null,
    first_token_ms: metrics.firstTokenMs || null,
  });

  await incrementSessionCounters(sessionId, {
    promptTokens: metrics.promptTokens || 0,
    completionTokens: metrics.completionTokens || 0,
  });

  return msg;
}

/**
 * List all files (user-uploaded and AI-generated) for a chat session.
 * Proxies through to the Devs.ai chat files API.
 */
export async function getChatSessionFiles(sessionId: string): Promise<
  Array<{
    id: string;
    source: string;
    filename: string;
    size: number;
    mimeType: string;
    url: string;
    status: string;
  }>
> {
  const session = await dbGetSession(sessionId);
  if (!session) throw new Error(`Chat session ${sessionId} not found`);
  if (!session.external_chat_id) return [];

  const profile = session.ai_profile;
  if (!profile?.provider) return [];
  const provider = await getSessionProviderWithKey(session);
  const client = await resolveSessionClient(session, provider);

  return (client as DevsAiClient).listChatFiles(session.external_chat_id);
}

/**
 * Get chat history — from local DB or from Devs.ai provider.
 */
export async function getChatHistory(
  sessionId: string,
  options: { fromProvider?: boolean } = {},
): Promise<Record<string, unknown>> {
  const session = await dbGetSession(sessionId);
  if (!session) throw new Error(`Chat session ${sessionId} not found`);

  if (options.fromProvider && session.provider_type === 'devs-ai' && session.external_chat_id) {
    if (session.ai_profile?.provider) {
      const provider = await getSessionProviderWithKey(session);
      const client = await resolveSessionClient(session, provider);
      if (typeof (client as DevsAiClient).getChatSession === 'function') {
        return (client as DevsAiClient).getChatSession(session.external_chat_id);
      }
    }
  }

  const messages = await listChatMessages(sessionId);
  return { ...session, messages };
}

/**
 * Close a chat session (mark as closed, keep data).
 *
 * The remote Devs.ai chat is intentionally PRESERVED so the session can be
 * resumed later via resumeChatSession. Remote cleanup happens on reset
 * (clears history) and delete (removes the session entirely).
 */
export async function closeChatSession(sessionId: string): Promise<ChatSessionRow> {
  const session = await dbGetSession(sessionId);
  if (!session) throw new Error(`Chat session ${sessionId} not found`);
  return dbUpdateSession(sessionId, { status: 'closed' });
}

/**
 * Reset a chat session — clear messages and optionally reset the remote session.
 */
export async function resetChatSession(sessionId: string): Promise<ChatSessionRow> {
  const session = await dbGetSession(sessionId);
  if (!session) throw new Error(`Chat session ${sessionId} not found`);

  if (session.provider_type === 'devs-ai' && session.external_chat_id) {
    try {
      if (session.ai_profile?.provider) {
        const provider = await getSessionProviderWithKey(session);
        const client = await resolveSessionClient(session, provider);
        if (typeof (client as DevsAiClient).resetChatSession === 'function') {
          await (client as DevsAiClient).resetChatSession(session.external_chat_id);
        }
      }
    } catch (_err) {
      /* best-effort */
    }
  }

  await deleteChatMessages(sessionId);

  const resetUpdates: Partial<ChatSessionRow> = {
    status: 'active',
    message_count: session.system_prompt ? 1 : 0,
    total_prompt_tokens: 0,
    total_completion_tokens: 0,
    workflow_variables: {},
  };
  if (session.provider_type === 'devs-ai-v2') {
    resetUpdates.provider_metadata = null;
  }

  if (session.system_prompt) {
    await createChatMessage({
      chat_session_id: sessionId,
      role: 'system',
      content: session.system_prompt,
    });
    resetUpdates.message_count = 1;
  }

  return dbUpdateSession(sessionId, resetUpdates);
}

/**
 * Delete a chat session and all its messages.
 */
export async function removeChatSession(sessionId: string): Promise<void> {
  const session = await dbGetSession(sessionId);
  if (!session) throw new Error(`Chat session ${sessionId} not found`);

  if (session.provider_type === 'devs-ai' && session.external_chat_id) {
    try {
      if (session.ai_profile?.provider) {
        const provider = await getSessionProviderWithKey(session);
        const client = await resolveSessionClient(session, provider);
        if (typeof (client as DevsAiClient).deleteChatSession === 'function') {
          await (client as DevsAiClient).deleteChatSession(session.external_chat_id);
        }
      }
    } catch (_err) {
      /* best-effort */
    }
  }

  return dbDeleteSession(sessionId);
}

/**
 * Best-effort purge of remote Devs.ai chats for all of a user's sessions in
 * the current workspace. Used by the compliance/user-data deletion paths:
 * because closing a session now PRESERVES the remote chat (so it can be
 * resumed), bulk row deletion would otherwise orphan remote chats on the
 * provider. Never throws — logs and continues. Returns the count purged.
 */
export async function purgeRemoteChatsForUser(userId: string): Promise<number> {
  let rows: Array<
    Pick<
      ChatSessionRow,
      'id' | 'ai_profile_id' | 'provider_type' | 'external_chat_id' | 'uses_user_credentials' | 'user_id'
    >
  > = [];
  try {
    const { data, error } = await tenantFrom('chat_sessions')
      .select('id, ai_profile_id, provider_type, external_chat_id, uses_user_credentials, user_id')
      .eq('user_id', userId)
      .eq('provider_type', 'devs-ai')
      .not('external_chat_id', 'is', null);
    if (error) throw new Error(error.message);
    rows = (data as typeof rows) || [];
  } catch (err) {
    console.warn('[ai-manager] purgeRemoteChatsForUser: failed to list sessions:', errorMessage(err));
    return 0;
  }

  let purged = 0;
  for (const row of rows) {
    try {
      const provider = await getSessionProviderWithKey(row as ChatSessionRow);
      const client = await resolveSessionClient(row as ChatSessionRow, provider);
      if (row.external_chat_id && typeof (client as DevsAiClient).deleteChatSession === 'function') {
        await (client as DevsAiClient).deleteChatSession(row.external_chat_id);
        purged++;
      }
    } catch (err) {
      console.warn(
        `[ai-manager] purgeRemoteChatsForUser: failed to delete remote chat ${row.external_chat_id}:`,
        errorMessage(err),
      );
    }
  }
  return purged;
}
