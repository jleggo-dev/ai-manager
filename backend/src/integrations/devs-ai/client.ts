/**
 * Devs.ai API Client
 * ------------------
 * Low-level HTTP client for the Devs.ai REST API.
 * Accepts baseUrl + apiKey so it can be instantiated dynamically
 * from any Provider record (not just env vars).
 *
 * API Docs: https://docs.devs.ai/api-spec
 * Auth:     Authorization: Bearer {apiKey}
 */

import type {
  ChatMessage,
  ChatCompletionResponse,
  ChatCompletionChoice,
  PatchedResponse,
} from "../../types.ts";
import { toOpenAiWireMessages } from "../../lib/message-content.ts";

type DevsAiEntity = Record<string, unknown>;

interface DevsAiRawCompletion {
  model?: string;
  choices: ChatCompletionChoice[];
  usage?: {
    prompt_tokens?: number | null;
    completion_tokens?: number | null;
    total_tokens?: number | null;
  } | null;
}

interface ChatFileRecord {
  id: string;
  source: string;
  filename: string;
  size: number;
  mimeType: string;
  url: string;
  status: string;
}

export class DevsAiClient {
  baseUrl: string;
  apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.apiKey = apiKey;
  }

  /* ── Internal helpers ──────────────────────────────────────── */

  /** Build the standard auth headers. */
  _headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.apiKey}`,
      ...extra,
    };
  }

  /** Generic request wrapper with error handling and optional timeout. */
  async _request<T = unknown>(
    method: string,
    path: string,
    body: unknown = null,
    extra: Record<string, unknown> = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const options: RequestInit = {
      method,
      headers: this._headers((extra.headers as Record<string, string>) || {}),
    };

    if (body && extra.rawBody !== true) {
      options.body = JSON.stringify(body);
    }
    if (body && extra.rawBody === true) {
      options.body = body as BodyInit;
      delete (options.headers as Record<string, string>)["Content-Type"];
    }

    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutMs = extra.timeoutMs as number | undefined;
    if (timeoutMs && timeoutMs > 0) {
      controller = new AbortController();
      options.signal = controller.signal;
      timer = setTimeout(() => controller?.abort(), timeoutMs);
    }

    let response: globalThis.Response;
    try {
      response = await fetch(url, options);
    } catch (err: unknown) {
      if ((err as Error).name === "AbortError") {
        throw new Error(`Devs.ai API request timed out after ${timeoutMs}ms`, {
          cause: err,
        });
      }
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Devs.ai API error (${response.status}): ${errorText}`);
    }

    if (response.status === 204) return null as T;
    const contentType = response.headers.get("content-type") || "";
    if (contentType.includes("application/json"))
      return response.json() as Promise<T>;
    const text = await response.text();
    if (!text) return null as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return { raw: text } as T;
    }
  }

  /* ── AI Management ─────────────────────────────────────────── */

  /**
   * List all AIs visible to the authenticated user.
   */
  async listAIs(
    scope: "ALL" | "OWNED" | "SHARED" = "ALL",
  ): Promise<DevsAiEntity[]> {
    return this._request<DevsAiEntity[]>("GET", `/api/v1/me/ai?scope=${scope}`);
  }

  /**
   * Attempt to list available model IDs from Devs.ai.
   * Tries common model-list endpoints and normalizes responses.
   */
  async listModels(): Promise<string[]> {
    const paths = ["/api/v1/models", "/v1/models"];
    let lastErr: Error | null = null;

    for (const path of paths) {
      try {
        const payload = await this._request("GET", path);
        return normalizeModelListPayload(payload);
      } catch (err: unknown) {
        lastErr = err as Error;
      }
    }

    throw lastErr || new Error("Unable to list models from Devs.ai");
  }

  /**
   * Get details for a specific AI.
   */
  async getAI(aiId: string): Promise<DevsAiEntity> {
    return this._request("GET", `/api/v1/ai/${aiId}`);
  }

  /* ── Chat Completions ──────────────────────────────────────── */

  /**
   * Send a chat completion request.
   */
  async chatCompletion(
    model: string,
    messages: ChatMessage[],
    options: Record<string, unknown> = {},
  ): Promise<ChatCompletionResponse> {
    const { timeoutMs, ...chatBody } = options;
    const data = await this._request<DevsAiRawCompletion>(
      "POST",
      "/api/v1/chat/completions",
      {
        model,
        // Multimodal parts are mapped to the OpenAI-compat wire dialect; plain text passes through.
        messages: toOpenAiWireMessages(messages),
        stream: false,
        ...chatBody,
      },
      { timeoutMs },
    );

    if (!data.usage) {
      console.debug(
        "[DevsAiClient] chatCompletion response has no usage field — token tracking unavailable for this call",
      );
    } else {
      data.usage = {
        prompt_tokens: data.usage.prompt_tokens ?? null,
        completion_tokens: data.usage.completion_tokens ?? null,
        total_tokens:
          data.usage.total_tokens ??
          ((data.usage.prompt_tokens || 0) +
            (data.usage.completion_tokens || 0) ||
            null),
      };
    }

    return data as ChatCompletionResponse;
  }

  /**
   * Send a streaming chat completion request and return the raw Response
   * for SSE consumption. Used for model-type profiles in chat workflows.
   */
  async chatCompletionStream(
    model: string,
    messages: ChatMessage[],
    options: Record<string, unknown> = {},
  ): Promise<globalThis.Response> {
    const { timeoutMs, ...chatBody } = options;

    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (timeoutMs && (timeoutMs as number) > 0) {
      controller = new AbortController();
      timer = setTimeout(() => controller?.abort(), timeoutMs as number);
    }

    let response: globalThis.Response;
    try {
      response = await fetch(`${this.baseUrl}/api/v1/chat/completions`, {
        method: "POST",
        headers: this._headers(),
        body: JSON.stringify({
          model,
          messages: toOpenAiWireMessages(messages),
          stream: true,
          ...chatBody,
        }),
        signal: controller?.signal,
      });
    } catch (err: unknown) {
      if (timer) clearTimeout(timer);
      if ((err as Error).name === "AbortError") {
        throw new Error(
          `Devs.ai streaming completion timed out after ${timeoutMs}ms`,
          { cause: err },
        );
      }
      throw err;
    }

    if (!response.ok) {
      if (timer) clearTimeout(timer);
      const errorText = await response.text();
      throw new Error(
        `Devs.ai streaming completion error (${response.status}): ${errorText}`,
      );
    }

    (response as PatchedResponse)._abortTimer = timer;
    (response as PatchedResponse)._abortController = controller;
    return response;
  }

  /* ── Chat Sessions ────────────────────────────────────────── */

  /**
   * Create a new chat session for an AI agent.
   */
  async createChatSession(aiId: string): Promise<DevsAiEntity> {
    return this._request("POST", `/api/v1/ai/${aiId}/chats`);
  }

  /**
   * Send a message to a chat session and return the raw fetch Response
   * so the caller can consume the SSE stream.
   */
  async messageChatSession(
    chatId: string,
    prompt: string | unknown[],
    options: { timeoutMs?: number; tools?: unknown[] } = {},
  ): Promise<globalThis.Response> {
    const { timeoutMs, tools } = options;
    const url = `${this.baseUrl}/api/v1/chats/${chatId}`;
    const body: Record<string, unknown> = {
      prompt,
      date: new Date().toISOString(),
    };
    if (Array.isArray(tools) && tools.length > 0) body.tools = tools;

    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (timeoutMs && timeoutMs > 0) {
      controller = new AbortController();
      timer = setTimeout(() => controller?.abort(), timeoutMs);
    }

    let response: globalThis.Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: this._headers(),
        body: JSON.stringify(body),
        signal: controller?.signal,
      });
    } catch (err: unknown) {
      if (timer) clearTimeout(timer);
      if ((err as Error).name === "AbortError") {
        throw new Error(`Devs.ai chat message timed out after ${timeoutMs}ms`, {
          cause: err,
        });
      }
      throw err;
    }

    if (!response.ok) {
      if (timer) clearTimeout(timer);
      const errorText = await response.text();
      throw new Error(
        `Devs.ai chat message error (${response.status}): ${errorText}`,
      );
    }

    (response as PatchedResponse)._abortTimer = timer;
    (response as PatchedResponse)._abortController = controller;
    return response;
  }

  /**
   * Get a chat session with full message history.
   */
  async getChatSession(chatId: string): Promise<DevsAiEntity> {
    return this._request("GET", `/api/v1/chats/${chatId}`);
  }

  /**
   * Reset (clear) a chat session's conversation history.
   */
  async resetChatSession(chatId: string): Promise<DevsAiEntity> {
    return this._request("PUT", `/api/v1/chats/${chatId}/reset`);
  }

  /**
   * Delete a chat session.
   */
  async deleteChatSession(chatId: string): Promise<null> {
    return this._request("DELETE", `/api/v1/chats/${chatId}`);
  }

  /**
   * List all chat sessions for an AI agent.
   */
  async listChatSessions(aiId: string): Promise<DevsAiEntity[]> {
    const payload = await this._request<{ data?: DevsAiEntity[] }>(
      "GET",
      `/api/v1/ai/${aiId}/chats`,
    );
    return Array.isArray(payload?.data) ? payload.data : [];
  }

  /* ── Tools (MCP, built-in, etc.) ──────────────────────────── */

  /**
   * List all tools configured on an AI agent.
   */
  async listTools(aiId: string): Promise<DevsAiEntity[]> {
    return this._request("GET", `/api/v1/ai/${aiId}/tools`);
  }

  /**
   * List MCP server tools configured on an AI agent.
   */
  async listMcpTools(aiId: string): Promise<DevsAiEntity[]> {
    return this._request("GET", `/api/v1/ai/${aiId}/tools/mcp`);
  }

  /**
   * List OAuth status for all tools on an AI agent.
   */
  async listToolAuthStatus(aiId: string): Promise<DevsAiEntity[]> {
    return this._request("GET", `/api/v1/ai/${aiId}/tools/auth`);
  }

  /**
   * Check OAuth status for a specific tool.
   */
  async getToolOAuthStatus(
    toolId: string,
  ): Promise<{ hasToken: boolean; scopes?: string }> {
    return this._request("GET", `/api/v1/tools/${toolId}/oauth-status`);
  }

  /**
   * Initiate an OAuth flow for a tool (returns an authorization URL).
   */
  async initiateToolOAuth(toolId: string): Promise<{ authUrl: string }> {
    return this._request("POST", `/api/v1/tools/${toolId}/oauth-initiate`);
  }

  /**
   * Delete (revoke) OAuth token for a tool.
   */
  async deleteToolOAuthToken(toolId: string): Promise<null> {
    return this._request("DELETE", `/api/v1/tools/${toolId}/oauth-token`);
  }

  /**
   * Preview available tools from an MCP server or template.
   */
  async previewMcpTools(config: Record<string, unknown>): Promise<{
    availableTools: unknown[];
    authenticationRequired: boolean;
    oauthDiscovery?: unknown;
    requiresToolSave?: boolean;
  }> {
    return this._request("POST", "/api/v1/tools/mcp/preview", config);
  }

  /**
   * Submit tool outputs (e.g. input field responses, OAuth completions)
   * back to a chat session. The AI continues the conversation after receiving them.
   */
  async submitToolOutputs(
    chatId: string,
    systemMessageId: string,
    outputs: Array<{ toolCallId: string; output: string }>,
    options: { timeoutMs?: number } = {},
  ): Promise<globalThis.Response> {
    const { timeoutMs } = options;
    const url = `${this.baseUrl}/api/v1/chats/${chatId}/tool-outputs`;
    const body = { systemMessageId, outputs };

    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (timeoutMs && timeoutMs > 0) {
      controller = new AbortController();
      timer = setTimeout(() => controller?.abort(), timeoutMs);
    }

    let response: globalThis.Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: this._headers(),
        body: JSON.stringify(body),
        signal: controller?.signal,
      });
    } catch (err: unknown) {
      if (timer) clearTimeout(timer);
      if ((err as Error).name === "AbortError") {
        throw new Error(
          `Devs.ai tool output submission timed out after ${timeoutMs}ms`,
          { cause: err },
        );
      }
      throw err;
    }

    if (!response.ok) {
      if (timer) clearTimeout(timer);
      const errorText = await response.text();
      throw new Error(
        `Devs.ai tool output error (${response.status}): ${errorText}`,
      );
    }

    (response as PatchedResponse)._abortTimer = timer;
    (response as PatchedResponse)._abortController = controller;
    return response;
  }

  /* ── Chat Files ────────────────────────────────────────────── */

  /**
   * Upload a file to a Devs.ai chat session (multipart).
   * After uploading, reference the returned `id` in ComplexMessageContent.
   */
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
    const blob =
      fileData instanceof Blob
        ? fileData
        : new Blob([new Uint8Array(fileData)], { type: mimeType });
    const form = new FormData();
    form.append("file", blob, fileName);
    form.append("source", "USER");

    return this._request("POST", `/api/v1/chats/${chatId}/files`, form, {
      rawBody: true,
    });
  }

  /**
   * List all files (USER-uploaded and SYSTEM-generated) in a chat session.
   */
  async listChatFiles(chatId: string): Promise<ChatFileRecord[]> {
    const payload = await this._request<{ data?: ChatFileRecord[] }>(
      "GET",
      `/api/v1/chats/${chatId}/files`,
    );
    return Array.isArray(payload?.data) ? payload.data : [];
  }

  /**
   * Create a standalone file record (or upload directly).
   */
  async createFileRecord(fileInfo: {
    filename: string;
    size: number;
    mimeType: string;
    metadata?: Record<string, unknown>;
  }): Promise<DevsAiEntity> {
    return this._request("POST", "/api/v1/files", fileInfo);
  }

  /* ── Data Sources ─────────────────────────────────────────── */

  /** List datasources attached to an AI agent. */
  async listAiDataSources(aiId: string): Promise<DevsAiEntity[]> {
    const payload = await this._request<{ data?: DevsAiEntity[] }>(
      "GET",
      `/api/v1/ai/${aiId}/data-sources`,
    );
    return Array.isArray(payload?.data) ? payload.data : [];
  }

  /** Delete a datasource by id. */
  async deleteDataSource(dataSourceId: string): Promise<null> {
    return this._request("DELETE", `/api/v1/data-sources/${dataSourceId}`);
  }

  /** Create API datasource for an AI agent. */
  async createApiDataSource(
    aiId: string,
    name: string,
    data: Record<string, unknown>,
  ): Promise<DevsAiEntity> {
    return this._request("POST", `/api/v1/ai/${aiId}/data-sources/api`, {
      name,
      data,
    });
  }

  /** Trigger datasource refresh/indexing. */
  async refreshDataSource(
    dataSourceId: string,
    forceRefresh: boolean = true,
  ): Promise<DevsAiEntity> {
    const force = forceRefresh ? "true" : "false";
    return this._request(
      "PUT",
      `/api/v1/data-sources/${dataSourceId}/refresh?forceRefresh=${force}`,
    );
  }
}

/**
 * Convenience: create a client from environment-based config.
 */
export function createDevsAiClient(devsAiConfig: {
  baseUrl: string;
  apiKey: string;
}): DevsAiClient {
  return new DevsAiClient(devsAiConfig.baseUrl, devsAiConfig.apiKey);
}

function extractModelId(row: unknown): string | undefined {
  if (typeof row === "string") return row;
  if (typeof row === "object" && row !== null) {
    const r = row as Record<string, unknown>;
    const id = r.id ?? r.model ?? r.name;
    return typeof id === "string" ? id : undefined;
  }
  return undefined;
}

function normalizeModelListPayload(payload: unknown): string[] {
  if (Array.isArray(payload)) {
    return payload.map(extractModelId).filter((v): v is string => Boolean(v));
  }

  if (typeof payload !== "object" || payload === null) return [];
  const obj = payload as Record<string, unknown>;

  const data = Array.isArray(obj.data) ? (obj.data as unknown[]) : [];
  if (data.length > 0) {
    return data.map(extractModelId).filter((v): v is string => Boolean(v));
  }

  const models = Array.isArray(obj.models) ? (obj.models as unknown[]) : [];
  if (models.length > 0) {
    return models.map(extractModelId).filter((v): v is string => Boolean(v));
  }

  return [];
}
