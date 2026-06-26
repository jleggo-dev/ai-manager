/**
 * Google Gemini Client
 * --------------------
 * Minimal wrapper around the Google Generative Language API.
 * Uses API key auth via `?key=...` query param.
 */

import type { ChatMessage, ChatCompletionResponse, ChatCompletionUsage, PatchedResponse } from '../../types.ts';

interface GeminiContent {
  role: string;
  parts: Array<{ text: string }>;
}

interface GeminiPayload {
  contents: GeminiContent[];
  systemInstruction?: { parts: Array<{ text: string }> };
  tools?: Array<Record<string, unknown>>;
}

interface GeminiCandidate {
  content?: { parts?: Array<{ text?: string }> };
  finishReason?: string;
}

interface GeminiModel {
  name?: string;
  supportedGenerationMethods?: string[];
  [key: string]: unknown;
}

interface GeminiModelsResponse {
  models?: GeminiModel[];
}

interface GeminiGenerateResponse {
  candidates?: GeminiCandidate[];
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
}

function trimSlash(url: string = ''): string {
  return String(url || '').replace(/\/+$/, '');
}

function toGeminiMessages(messages: ChatMessage[] = [], options: Record<string, unknown> = {}): GeminiPayload {
  const contents: GeminiContent[] = [];
  const systemParts: Array<{ text: string }> = [];

  for (const msg of messages || []) {
    const text = String(msg?.content || '').trim();
    if (!text) continue;

    if (msg.role === 'system') {
      systemParts.push({ text });
      continue;
    }

    const role = msg.role === 'assistant' ? 'model' : 'user';
    contents.push({ role, parts: [{ text }] });
  }

  const payload: GeminiPayload = {
    contents: contents.length > 0 ? contents : [{ role: 'user', parts: [{ text: '' }] }],
    systemInstruction: systemParts.length > 0 ? { parts: systemParts } : undefined,
  };

  if (options.groundingWithGoogleSearch === true) {
    payload.tools = [{ google_search: {} }];
  }

  return payload;
}

function joinCandidateText(candidate: GeminiCandidate | null): string {
  const parts = candidate?.content?.parts || [];
  return parts
    .map((p) => (typeof p?.text === 'string' ? p.text : ''))
    .filter(Boolean)
    .join('\n')
    .trim();
}

export class GoogleGeminiClient {
  baseUrl: string;
  apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = trimSlash(baseUrl || 'https://generativelanguage.googleapis.com');
    this.apiKey = apiKey;
  }

  async request<T = Record<string, unknown>>(
    path: string,
    options: RequestInit & { timeoutMs?: number } = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;

    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutMs = options.timeoutMs;
    if (timeoutMs && timeoutMs > 0) {
      controller = new AbortController();
      timer = setTimeout(() => controller?.abort(), timeoutMs);
    }

    let res: globalThis.Response;
    try {
      res = await fetch(url, {
        ...options,
        signal: controller?.signal,
        headers: {
          'x-goog-api-key': this.apiKey,
          'Content-Type': 'application/json',
          ...((options.headers as Record<string, string>) || {}),
        },
      });
    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') {
        throw new Error(`Google Gemini request timed out after ${timeoutMs}ms`, { cause: err });
      }
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
    const text = await res.text();
    let json: { error?: { message?: string }; [key: string]: unknown } | null = null;
    if (text) {
      try {
        json = JSON.parse(text);
      } catch (_err) {
        json = null;
      }
    }
    if (!res.ok) {
      const detail = json?.error?.message || text || `HTTP ${res.status}`;
      throw new Error(`Google Gemini request failed: ${detail}`);
    }
    return (json ?? {}) as T;
  }

  async chatCompletion(
    model: string,
    messages: ChatMessage[] = [],
    options: Record<string, unknown> = {},
  ): Promise<ChatCompletionResponse> {
    const { timeoutMs, ...chatOpts } = options;
    const requestedModel = String(model || '').trim();
    const resolvedModel = await this.resolveGenerateContentModel(requestedModel);
    const payload = toGeminiMessages(messages, chatOpts);
    const data = await this.request<GeminiGenerateResponse>(
      `/v1beta/models/${encodeURIComponent(resolvedModel)}:generateContent`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
        timeoutMs: timeoutMs as number | undefined,
      },
    );

    const candidate: GeminiCandidate | null = Array.isArray(data?.candidates) ? (data.candidates[0] ?? null) : null;
    const content = joinCandidateText(candidate);
    const usage: ChatCompletionUsage | null = data?.usageMetadata
      ? {
          prompt_tokens: data.usageMetadata.promptTokenCount ?? null,
          completion_tokens: data.usageMetadata.candidatesTokenCount ?? null,
          total_tokens: data.usageMetadata.totalTokenCount ?? null,
        }
      : null;

    return {
      model: resolvedModel || requestedModel,
      choices: [
        {
          message: { content },
          finish_reason: String(candidate?.finishReason || '').toLowerCase() || null,
        },
      ],
      usage,
      raw: data,
    };
  }

  /**
   * Stream a chat completion via Gemini's streamGenerateContent endpoint.
   * Returns the raw fetch Response so the caller can consume SSE chunks.
   * Each SSE line: data: { "candidates": [{ "content": { "parts": [{ "text": "..." }] } }] }
   */
  async chatCompletionStream(
    model: string,
    messages: ChatMessage[] = [],
    options: Record<string, unknown> = {},
  ): Promise<globalThis.Response> {
    const { timeoutMs, ...chatOpts } = options;
    const resolvedModel = await this.resolveGenerateContentModel(String(model || '').trim());
    const payload = toGeminiMessages(messages, chatOpts);
    const path = `/v1beta/models/${encodeURIComponent(resolvedModel)}:streamGenerateContent?alt=sse`;
    const url = `${this.baseUrl}${path}`;

    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (timeoutMs && (timeoutMs as number) > 0) {
      controller = new AbortController();
      timer = setTimeout(() => controller?.abort(), timeoutMs as number);
    }

    let res: globalThis.Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'x-goog-api-key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller?.signal,
      });
    } catch (err: unknown) {
      if (timer) clearTimeout(timer);
      if ((err as Error).name === 'AbortError') {
        throw new Error(`Google Gemini stream timed out after ${timeoutMs}ms`, { cause: err });
      }
      throw err;
    }

    if (!res.ok) {
      if (timer) clearTimeout(timer);
      const text = await res.text();
      throw new Error(`Google Gemini stream failed: ${text || `HTTP ${res.status}`}`);
    }

    (res as PatchedResponse)._abortTimer = timer;
    (res as PatchedResponse)._abortController = controller;
    return res;
  }

  async listModels(): Promise<GeminiModel[]> {
    const data = await this.request<GeminiModelsResponse>('/v1beta/models', { method: 'GET' });
    return Array.isArray(data?.models) ? data.models : [];
  }

  async resolveGenerateContentModel(requestedModel: string): Promise<string> {
    const requested = String(requestedModel || '').trim();
    if (!requested) return requested;

    const models = await this.listModels();
    const callable = (models || [])
      .filter(
        (m: GeminiModel) =>
          Array.isArray(m?.supportedGenerationMethods) && m.supportedGenerationMethods.includes('generateContent'),
      )
      .map((m: GeminiModel) => String(m?.name || '').trim())
      .filter((name: string) => name.startsWith('models/'))
      .map((name: string) => name.replace(/^models\//, ''));

    if (callable.includes(requested)) return requested;

    const exactLatest = callable.find((id: string) => id === `${requested}-latest`);
    if (exactLatest) return exactLatest;

    const exactPreview = callable.find((id: string) => id.startsWith(`${requested}-preview`));
    if (exactPreview) return exactPreview;

    const exactNumbered = callable.find((id: string) => id.startsWith(`${requested}-`) && /\d/.test(id));
    if (exactNumbered) return exactNumbered;

    return requested;
  }
}
