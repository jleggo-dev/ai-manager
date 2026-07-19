/**
 * Tools — MCP/built-in tool listing, OAuth, preview, and tool-output submission.
 */

import type { DevsAiEntity, DevsAiHttp } from './types.ts';
import { openSseStream } from './request.ts';

/** List all tools configured on an AI agent. */
export async function listTools(client: DevsAiHttp, aiId: string): Promise<DevsAiEntity[]> {
  return client._request('GET', `/api/v1/ai/${aiId}/tools`);
}

/** List MCP server tools configured on an AI agent. */
export async function listMcpTools(client: DevsAiHttp, aiId: string): Promise<DevsAiEntity[]> {
  return client._request('GET', `/api/v1/ai/${aiId}/tools/mcp`);
}

/** List OAuth status for all tools on an AI agent. */
export async function listToolAuthStatus(client: DevsAiHttp, aiId: string): Promise<DevsAiEntity[]> {
  return client._request('GET', `/api/v1/ai/${aiId}/tools/auth`);
}

/** Check OAuth status for a specific tool. */
export async function getToolOAuthStatus(
  client: DevsAiHttp,
  toolId: string,
): Promise<{ hasToken: boolean; scopes?: string }> {
  return client._request('GET', `/api/v1/tools/${toolId}/oauth-status`);
}

/** Initiate an OAuth flow for a tool (returns an authorization URL). */
export async function initiateToolOAuth(client: DevsAiHttp, toolId: string): Promise<{ authUrl: string }> {
  return client._request('POST', `/api/v1/tools/${toolId}/oauth-initiate`);
}

/** Delete (revoke) OAuth token for a tool. */
export async function deleteToolOAuthToken(client: DevsAiHttp, toolId: string): Promise<null> {
  return client._request('DELETE', `/api/v1/tools/${toolId}/oauth-token`);
}

/** Preview available tools from an MCP server or template. */
export async function previewMcpTools(
  client: DevsAiHttp,
  config: Record<string, unknown>,
): Promise<{
  availableTools: unknown[];
  authenticationRequired: boolean;
  oauthDiscovery?: unknown;
  requiresToolSave?: boolean;
}> {
  return client._request('POST', '/api/v1/tools/mcp/preview', config);
}

/**
 * Submit tool outputs (e.g. input field responses, OAuth completions)
 * back to a chat session. The AI continues the conversation after receiving them.
 */
export async function submitToolOutputs(
  client: DevsAiHttp,
  chatId: string,
  systemMessageId: string,
  outputs: Array<{ toolCallId: string; output: string }>,
  options: { timeoutMs?: number } = {},
): Promise<globalThis.Response> {
  const { timeoutMs } = options;
  return openSseStream(
    `${client.baseUrl}/api/v1/chats/${chatId}/tool-outputs`,
    client._headers(),
    { systemMessageId, outputs },
    {
      timeoutMs,
      timeoutLabel: 'tool output submission',
      errorLabel: 'tool output',
    },
  );
}
