/**
 * Devs.ai API Client
 * ------------------
 * Low-level HTTP client for the Devs.ai REST API.
 * Accepts baseUrl + apiKey so it can be instantiated dynamically
 * from any Provider record (not just env vars).
 *
 * Method bodies live in per-surface modules under this folder; this class
 * keeps the single construction site callers expect.
 *
 * API Docs: https://docs.devs.ai/api-spec
 * Auth:     Authorization: Bearer {apiKey}
 *
 * Surfaces:
 *   - AI Management      → ai.ts
 *   - Chat Completions   → completions.ts
 *   - Chat Sessions      → sessions.ts
 *   - Tools / OAuth      → tools.ts
 *   - Chat Files         → files.ts
 *   - Data Sources       → data-sources.ts
 */

import type { ChatMessage, ChatCompletionResponse } from '../../types.ts';
import { buildAuthHeaders, jsonRequest } from './request.ts';
import * as ai from './ai.ts';
import * as completions from './completions.ts';
import * as sessions from './sessions.ts';
import * as tools from './tools.ts';
import * as files from './files.ts';
import * as dataSources from './data-sources.ts';
import type { ChatFileRecord, DevsAiEntity } from './types.ts';

export class DevsAiClient {
  baseUrl: string;
  apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
  }

  /* ── Internal helpers ──────────────────────────────────────── */

  /** Build the standard auth headers. */
  _headers(extra: Record<string, string> = {}): Record<string, string> {
    return buildAuthHeaders(this.apiKey, extra);
  }

  /** Generic request wrapper with error handling and optional timeout. */
  async _request<T = unknown>(
    method: string,
    path: string,
    body: unknown = null,
    extra: Record<string, unknown> = {},
  ): Promise<T> {
    return jsonRequest<T>(this.baseUrl, this.apiKey, method, path, body, extra);
  }

  /* ── AI Management ─────────────────────────────────────────── */

  async listAIs(scope: 'ALL' | 'OWNED' | 'SHARED' = 'ALL'): Promise<DevsAiEntity[]> {
    return ai.listAIs(this, scope);
  }

  async listModels(): Promise<string[]> {
    return ai.listModels(this);
  }

  async getAI(aiId: string): Promise<DevsAiEntity> {
    return ai.getAI(this, aiId);
  }

  /* ── Chat Completions ──────────────────────────────────────── */

  async chatCompletion(
    model: string,
    messages: ChatMessage[],
    options: Record<string, unknown> = {},
  ): Promise<ChatCompletionResponse> {
    return completions.chatCompletion(this, model, messages, options);
  }

  async chatCompletionStream(
    model: string,
    messages: ChatMessage[],
    options: Record<string, unknown> = {},
  ): Promise<globalThis.Response> {
    return completions.chatCompletionStream(this, model, messages, options);
  }

  /* ── Chat Sessions ────────────────────────────────────────── */

  async createChatSession(aiId: string): Promise<DevsAiEntity> {
    return sessions.createChatSession(this, aiId);
  }

  async messageChatSession(
    chatId: string,
    prompt: string | unknown[],
    options: { timeoutMs?: number; tools?: unknown[] } = {},
  ): Promise<globalThis.Response> {
    return sessions.messageChatSession(this, chatId, prompt, options);
  }

  async getChatSession(chatId: string): Promise<DevsAiEntity> {
    return sessions.getChatSession(this, chatId);
  }

  async resetChatSession(chatId: string): Promise<DevsAiEntity> {
    return sessions.resetChatSession(this, chatId);
  }

  async deleteChatSession(chatId: string): Promise<null> {
    return sessions.deleteChatSession(this, chatId);
  }

  async listChatSessions(aiId: string): Promise<DevsAiEntity[]> {
    return sessions.listChatSessions(this, aiId);
  }

  /* ── Tools (MCP, built-in, etc.) ──────────────────────────── */

  async listTools(aiId: string): Promise<DevsAiEntity[]> {
    return tools.listTools(this, aiId);
  }

  async listMcpTools(aiId: string): Promise<DevsAiEntity[]> {
    return tools.listMcpTools(this, aiId);
  }

  async listToolAuthStatus(aiId: string): Promise<DevsAiEntity[]> {
    return tools.listToolAuthStatus(this, aiId);
  }

  async getToolOAuthStatus(toolId: string): Promise<{ hasToken: boolean; scopes?: string }> {
    return tools.getToolOAuthStatus(this, toolId);
  }

  async initiateToolOAuth(toolId: string): Promise<{ authUrl: string }> {
    return tools.initiateToolOAuth(this, toolId);
  }

  async deleteToolOAuthToken(toolId: string): Promise<null> {
    return tools.deleteToolOAuthToken(this, toolId);
  }

  async previewMcpTools(config: Record<string, unknown>): Promise<{
    availableTools: unknown[];
    authenticationRequired: boolean;
    oauthDiscovery?: unknown;
    requiresToolSave?: boolean;
  }> {
    return tools.previewMcpTools(this, config);
  }

  async submitToolOutputs(
    chatId: string,
    systemMessageId: string,
    outputs: Array<{ toolCallId: string; output: string }>,
    options: { timeoutMs?: number } = {},
  ): Promise<globalThis.Response> {
    return tools.submitToolOutputs(this, chatId, systemMessageId, outputs, options);
  }

  /* ── Chat Files ────────────────────────────────────────────── */

  async uploadChatFile(
    chatId: string,
    fileData: Buffer | Blob,
    fileName: string,
    mimeType: string,
  ): Promise<{
    id: string;
    filename: string;
    size: number;
    mimeType: string;
    url: string;
    status: string;
  }> {
    return files.uploadChatFile(this, chatId, fileData, fileName, mimeType);
  }

  async listChatFiles(chatId: string): Promise<ChatFileRecord[]> {
    return files.listChatFiles(this, chatId);
  }

  async createFileRecord(fileInfo: {
    filename: string;
    size: number;
    mimeType: string;
    metadata?: Record<string, unknown>;
  }): Promise<DevsAiEntity> {
    return files.createFileRecord(this, fileInfo);
  }

  /* ── Data Sources ─────────────────────────────────────────── */

  async listAiDataSources(aiId: string): Promise<DevsAiEntity[]> {
    return dataSources.listAiDataSources(this, aiId);
  }

  async deleteDataSource(dataSourceId: string): Promise<null> {
    return dataSources.deleteDataSource(this, dataSourceId);
  }

  async createApiDataSource(aiId: string, name: string, data: Record<string, unknown>): Promise<DevsAiEntity> {
    return dataSources.createApiDataSource(this, aiId, name, data);
  }

  async refreshDataSource(dataSourceId: string, forceRefresh: boolean = true): Promise<DevsAiEntity> {
    return dataSources.refreshDataSource(this, dataSourceId, forceRefresh);
  }
}

/**
 * Convenience: create a client from environment-based config.
 */
export function createDevsAiClient(devsAiConfig: { baseUrl: string; apiKey: string }): DevsAiClient {
  return new DevsAiClient(devsAiConfig.baseUrl, devsAiConfig.apiKey);
}
