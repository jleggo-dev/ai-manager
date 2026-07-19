import { resolveApiUrl } from '../../lib/api-url';
import { getApiAuthHeaders, request } from './client';
import type { ChatSession, ChatMessage, PaginatedResponse } from '../../types/api';

/* ── Chat Sessions ─────────────────────────────────────────────── */

interface CreateChatSessionParams {
  aiProfileId?: string;
  jobSlug?: string;
  jobId?: string;
  userId: string;
  callingApplication?: string;
  systemPrompt?: string;
}

export async function createChatSession({
  aiProfileId,
  jobSlug,
  jobId,
  userId,
  callingApplication,
  systemPrompt,
}: CreateChatSessionParams): Promise<ChatSession> {
  return request('/api/chat-sessions', {
    method: 'POST',
    body: JSON.stringify({
      aiProfileId: aiProfileId || undefined,
      jobSlug: jobSlug || undefined,
      jobId: jobId || undefined,
      userId,
      callingApplication: callingApplication || 'ai-admin',
      systemPrompt: systemPrompt || undefined,
    }),
  });
}

export function sendChatMessageStream(sessionId: string, message: string): Promise<Response> {
  return fetch(resolveApiUrl(`/api/chat-sessions/${sessionId}/messages`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getApiAuthHeaders() },
    body: JSON.stringify({ message }),
  });
}

interface ChatSessionFilters {
  userId?: string;
  aiProfileId?: string;
  workflowId?: string;
  status?: string;
}

export async function listChatSessions(
  filters: ChatSessionFilters & { cursor?: string; limit?: number } = {},
): Promise<PaginatedResponse<ChatSession>> {
  const params = new URLSearchParams();
  if (filters.userId) params.set('userId', filters.userId);
  if (filters.aiProfileId) params.set('aiProfileId', filters.aiProfileId);
  if (filters.workflowId) params.set('workflowId', filters.workflowId);
  if (filters.status) params.set('status', filters.status);
  if (filters.cursor) params.set('cursor', filters.cursor);
  if (filters.limit) params.set('limit', String(filters.limit));
  const qs = params.toString();
  return request(`/api/chat-sessions${qs ? `?${qs}` : ''}`);
}

export async function getChatSession(sessionId: string): Promise<ChatSession> {
  return request(`/api/chat-sessions/${sessionId}`);
}

export async function getChatMessages(
  sessionId: string,
  { fromProvider }: { fromProvider?: boolean } = {},
): Promise<ChatMessage[]> {
  const qs = fromProvider ? '?fromProvider=true' : '';
  return request(`/api/chat-sessions/${sessionId}/messages${qs}`);
}

export async function resetChatSession(sessionId: string): Promise<ChatSession> {
  return request(`/api/chat-sessions/${sessionId}/reset`, { method: 'PUT' });
}

export async function closeChatSession(sessionId: string): Promise<ChatSession> {
  return request(`/api/chat-sessions/${sessionId}/close`, { method: 'PUT' });
}

export async function deleteChatSession(sessionId: string): Promise<void> {
  return request(`/api/chat-sessions/${sessionId}`, { method: 'DELETE' });
}

export function submitChatToolOutputs(
  sessionId: string,
  systemMessageId: string,
  outputs: Record<string, unknown>[],
): Promise<Response> {
  return fetch(resolveApiUrl(`/api/chat-sessions/${sessionId}/tool-outputs`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getApiAuthHeaders() },
    body: JSON.stringify({ systemMessageId, outputs }),
  });
}
