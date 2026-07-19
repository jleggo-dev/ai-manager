/**
 * Chat Sessions — create/message/get/reset/delete/list agent chat sessions.
 */

import type { DevsAiEntity, DevsAiHttp } from './types.ts';
import { openSseStream } from './request.ts';

/** Create a new chat session for an AI agent. */
export async function createChatSession(client: DevsAiHttp, aiId: string): Promise<DevsAiEntity> {
  return client._request('POST', `/api/v1/ai/${aiId}/chats`);
}

/**
 * Send a message to a chat session and return the raw fetch Response
 * so the caller can consume the SSE stream.
 */
export async function messageChatSession(
  client: DevsAiHttp,
  chatId: string,
  prompt: string | unknown[],
  options: { timeoutMs?: number; tools?: unknown[] } = {},
): Promise<globalThis.Response> {
  const { timeoutMs, tools } = options;
  const body: Record<string, unknown> = {
    prompt,
    date: new Date().toISOString(),
  };
  if (Array.isArray(tools) && tools.length > 0) body.tools = tools;

  return openSseStream(`${client.baseUrl}/api/v1/chats/${chatId}`, client._headers(), body, {
    timeoutMs,
    timeoutLabel: 'chat message',
    errorLabel: 'chat message',
  });
}

/** Get a chat session with full message history. */
export async function getChatSession(client: DevsAiHttp, chatId: string): Promise<DevsAiEntity> {
  return client._request('GET', `/api/v1/chats/${chatId}`);
}

/** Reset (clear) a chat session's conversation history. */
export async function resetChatSession(client: DevsAiHttp, chatId: string): Promise<DevsAiEntity> {
  return client._request('PUT', `/api/v1/chats/${chatId}/reset`);
}

/** Delete a chat session. */
export async function deleteChatSession(client: DevsAiHttp, chatId: string): Promise<null> {
  return client._request('DELETE', `/api/v1/chats/${chatId}`);
}

/** List all chat sessions for an AI agent. */
export async function listChatSessions(client: DevsAiHttp, aiId: string): Promise<DevsAiEntity[]> {
  const payload = await client._request<{ data?: DevsAiEntity[] }>('GET', `/api/v1/ai/${aiId}/chats`);
  return Array.isArray(payload?.data) ? payload.data : [];
}
