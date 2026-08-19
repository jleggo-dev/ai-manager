/**
 * Model – Chat Sessions & Chat Messages
 * ---------------------------------------
 * CRUD for the chat_sessions and chat_messages tables in the AI Manager DB.
 */

import type { ChatSessionRow, ChatMessageRow } from '../types.ts';
import { tenantFrom, tenantInsertPayload, requireWorkspaceId } from '../db/tenant.ts';
import { getServiceSupabase } from '../db/service-supabase.ts';

const SESSION_TABLE = 'chat_sessions';
const MESSAGE_TABLE = 'chat_messages';

const STALE_LOCK_MS = 5 * 60 * 1000 + 30 * 1000; // MAX_SSE_DURATION (5 min) + 30 s buffer

/* Shared select string so single-row reads always hydrate the AI profile + provider. */
const SESSION_SELECT =
  '*, ai_profile:ai_profiles!chat_sessions_ai_profile_id_fkey(id, name, external_ai_id, mode, config, provider:providers!ai_profiles_provider_id_fkey(id, name, type, base_url))';

/* ── Sessions ───────────────────────────────────────────────── */

export async function createChatSession(data: Partial<ChatSessionRow>): Promise<ChatSessionRow> {
  const { data: row, error } = await tenantFrom(SESSION_TABLE)
    .insert(tenantInsertPayload({ ...data, updated_at: new Date().toISOString() }))
    .select()
    .single();
  if (error) throw new Error(`Chat session insert error: ${error.message}`);
  return row;
}

export async function getChatSession(id: string): Promise<ChatSessionRow | null> {
  const { data: row, error } = await tenantFrom(SESSION_TABLE).select(SESSION_SELECT).eq('id', id).maybeSingle();
  if (error) throw new Error(`Chat session get error: ${error.message}`);
  return row;
}

/**
 * Look up a chat session by its provider-side chat id (e.g. the Devs.ai
 * external_chat_id). Tenant-scoped — only returns sessions in the caller's
 * workspace, so a provider id from another tenant resolves to null (no
 * existence leak). Returns the most recent match if more than one exists.
 */
export async function getChatSessionByExternalChatId(externalChatId: string): Promise<ChatSessionRow | null> {
  const { data, error } = await tenantFrom(SESSION_TABLE)
    .select(SESSION_SELECT)
    .eq('external_chat_id', externalChatId)
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw new Error(`Chat session lookup error: ${error.message}`);
  return data?.[0] ?? null;
}

/**
 * Reactivate a chat session (status -> 'active') so a closed conversation
 * can be resumed and continued. Does not touch the processing lock — stale
 * locks are reclaimed by the send path on the next message.
 */
export async function reactivateChatSession(id: string): Promise<ChatSessionRow> {
  return updateChatSession(id, { status: 'active' });
}

export async function updateChatSession(id: string, updates: Partial<ChatSessionRow>): Promise<ChatSessionRow> {
  const { data: row, error } = await tenantFrom(SESSION_TABLE)
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();
  if (error) throw new Error(`Chat session update error: ${error.message}`);
  return row;
}

export async function deleteChatSession(id: string): Promise<void> {
  const { error } = await tenantFrom(SESSION_TABLE).delete().eq('id', id);
  if (error) throw new Error(`Chat session delete error: ${error.message}`);
}

interface ChatSessionFilters {
  userId?: string;
  aiProfileId?: string;
  workflowId?: string;
  status?: string;
  callingApplication?: string;
  externalChatId?: string;
}

export async function listChatSessions(
  filters: ChatSessionFilters & { cursor?: string; limit?: number } = {},
): Promise<ChatSessionRow[]> {
  const limit = filters.limit || 50;
  let query = tenantFrom(SESSION_TABLE)
    .select('*, ai_profile:ai_profiles!chat_sessions_ai_profile_id_fkey(id, name)')
    .order('created_at', { ascending: false })
    .limit(limit + 1);
  if (filters.userId) query = query.eq('user_id', filters.userId);
  if (filters.aiProfileId) query = query.eq('ai_profile_id', filters.aiProfileId);
  if (filters.workflowId) query = query.eq('workflow_id', filters.workflowId);
  if (filters.status) query = query.eq('status', filters.status);
  if (filters.callingApplication) query = query.eq('calling_application', filters.callingApplication);
  if (filters.externalChatId) query = query.eq('external_chat_id', filters.externalChatId);
  if (filters.cursor) {
    query = query.lt('created_at', filters.cursor);
  }
  const { data, error } = await query;
  if (error) throw new Error(`Chat session list error: ${error.message}`);
  return data || [];
}

interface IncrementCounterOptions {
  promptTokens?: number;
  completionTokens?: number;
}

/**
 * Increment session counters after a message exchange.
 * Uses optimistic locking on message_count to prevent lost updates under concurrency.
 */
export async function incrementSessionCounters(
  id: string,
  { promptTokens = 0, completionTokens = 0 }: IncrementCounterOptions = {},
): Promise<ChatSessionRow> {
  const session = await getChatSession(id);
  if (!session) throw new Error(`Chat session ${id} not found`);

  const { data, error } = await tenantFrom(SESSION_TABLE)
    .update({
      message_count: (session.message_count || 0) + 1,
      total_prompt_tokens: (session.total_prompt_tokens || 0) + (promptTokens || 0),
      total_completion_tokens: (session.total_completion_tokens || 0) + (completionTokens || 0),
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('message_count', session.message_count || 0)
    .select()
    .single();

  if (error || !data) {
    const fresh = await getChatSession(id);
    if (!fresh) throw new Error(`Chat session ${id} not found`);
    return updateChatSession(id, {
      message_count: (fresh.message_count || 0) + 1,
      total_prompt_tokens: (fresh.total_prompt_tokens || 0) + (promptTokens || 0),
      total_completion_tokens: (fresh.total_completion_tokens || 0) + (completionTokens || 0),
    });
  }
  return data as ChatSessionRow;
}

/* ── Concurrency Lock ────────────────────────────────────────── */

/**
 * Atomically acquire a processing lock on a chat session.
 * Returns true if the lock was acquired, false if the session is already
 * processing another message (caller should respond with 409).
 * Stale locks (older than STALE_LOCK_MS) are automatically reclaimed.
 *
 * Gracefully returns true (no-op) if the lock columns have not been
 * added yet (migration 018_session_concurrency_guard not applied).
 */
export async function acquireSessionLock(sessionId: string, messageId: string): Promise<boolean> {
  const staleCutoff = new Date(Date.now() - STALE_LOCK_MS).toISOString();
  const now = new Date().toISOString();

  const { data, error } = await tenantFrom(SESSION_TABLE)
    .update({
      processing_message_id: messageId,
      processing_started_at: now,
      updated_at: now,
    })
    .eq('id', sessionId)
    .or(`processing_message_id.is.null,processing_started_at.lt.${staleCutoff}`)
    .select('id')
    .maybeSingle();

  if (error) {
    if (error.message?.includes('processing_message_id')) {
      console.warn('[chat-sessions] Concurrency lock columns missing — skipping lock (apply migration 018).');
      return true;
    }
    throw new Error(`Session lock acquire error: ${error.message}`);
  }
  return data !== null;
}

/**
 * Release the processing lock on a chat session.
 * Only clears the lock if it still belongs to the given messageId,
 * preventing accidental release of a lock reclaimed by another request.
 *
 * Silently no-ops if the lock columns have not been added yet.
 */
export async function releaseSessionLock(sessionId: string, messageId: string): Promise<void> {
  const { error } = await tenantFrom(SESSION_TABLE)
    .update({
      processing_message_id: null,
      processing_started_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', sessionId)
    .eq('processing_message_id', messageId);

  if (error) {
    if (error.message?.includes('processing_message_id')) {
      return;
    }
    throw new Error(`Session lock release error: ${error.message}`);
  }
}

/* ── Messages ───────────────────────────────────────────────── */

export async function createChatMessage(data: Partial<ChatMessageRow>): Promise<ChatMessageRow> {
  const { data: row, error } = await tenantFrom(MESSAGE_TABLE).insert(tenantInsertPayload(data)).select().single();
  if (error) throw new Error(`Chat message insert error: ${error.message}`);
  return row;
}

export async function listChatMessages(sessionId: string): Promise<ChatMessageRow[]> {
  const { data, error } = await tenantFrom(MESSAGE_TABLE)
    .select('*')
    .eq('chat_session_id', sessionId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`Chat message list error: ${error.message}`);
  return data || [];
}

/** Rewrite one stored message. The system row is the only caller today (see session-persona-refresh). */
export async function updateChatMessage(id: string, updates: Partial<ChatMessageRow>): Promise<ChatMessageRow> {
  const { data: row, error } = await tenantFrom(MESSAGE_TABLE).update(updates).eq('id', id).select().single();
  if (error) throw new Error(`Chat message update error: ${error.message}`);
  return row;
}

export async function deleteChatMessages(sessionId: string): Promise<void> {
  const { error } = await tenantFrom(MESSAGE_TABLE).delete().eq('chat_session_id', sessionId);
  if (error) throw new Error(`Chat messages delete error: ${error.message}`);
}

/* ── Workflow Variables ─────────────────────────────────────── */

/**
 * Atomically merge new key-value pairs into a session's workflow_variables JSONB.
 * Uses the merge_workflow_variables RPC (Postgres || operator) for safe concurrency.
 */
export async function mergeWorkflowVariables(
  sessionId: string,
  newVars: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const { data, error } = await getServiceSupabase().rpc('merge_workflow_variables', {
    p_session_id: sessionId,
    p_new_vars: newVars,
    p_workspace_id: requireWorkspaceId(),
  });
  if (error) throw new Error(`merge_workflow_variables failed: ${error.message}`);
  return (data as Record<string, unknown>) ?? newVars;
}

interface ChatSessionStats {
  messageCount: number;
  assistantMessageCount: number;
  avgResponseMs: number;
  avgFirstTokenMs: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
}

/**
 * Aggregate session-level stats from chat_messages for diagnostics.
 */
export async function getChatSessionStats(sessionId: string): Promise<ChatSessionStats> {
  const messages = await listChatMessages(sessionId);
  const assistantMsgs = messages.filter((m) => m.role === 'assistant');
  const totalDuration = assistantMsgs.reduce((sum, m) => sum + (m.duration_ms || 0), 0);
  const totalFirstToken = assistantMsgs.reduce((sum, m) => sum + (m.first_token_ms || 0), 0);
  const totalPrompt = assistantMsgs.reduce((sum, m) => sum + (m.prompt_tokens || 0), 0);
  const totalCompletion = assistantMsgs.reduce((sum, m) => sum + (m.completion_tokens || 0), 0);
  const count = assistantMsgs.length || 1;

  return {
    messageCount: messages.length,
    assistantMessageCount: assistantMsgs.length,
    avgResponseMs: Math.round(totalDuration / count),
    avgFirstTokenMs: Math.round(totalFirstToken / count),
    totalPromptTokens: totalPrompt,
    totalCompletionTokens: totalCompletion,
    totalTokens: totalPrompt + totalCompletion,
  };
}
