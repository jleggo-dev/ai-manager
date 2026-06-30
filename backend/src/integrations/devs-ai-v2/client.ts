/**
 * Devs.ai Responses API v2 Client
 * ---------------------------------
 * Implements LlmClient via POST /api/v2/responses (OpenAI Responses-compatible).
 * v1 DevsAiClient is unchanged — this is a separate provider type (devs-ai-v2).
 *
 * API Docs: https://docs.devs.ai/api-spec (Responses API v2 section)
 */

import type { ChatMessage, ChatCompletionResponse, PatchedResponse } from '../../types.ts';
import type { V2ResponseObject } from './types.ts';
import { messagesToV2Request, extractV2ResponseText, mapV2Usage } from './request-builder.ts';
import { createSseTransformState, transformV2SseChunk } from './sse-transform.ts';

export class DevsAiV2Client {
  baseUrl: string;
  apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.apiKey = apiKey;
  }

  _headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
      ...extra,
    };
  }

  async _request<T = unknown>(
    method: string,
    path: string,
    body: unknown = null,
    extra: Record<string, unknown> = {},
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const options: RequestInit = { method, headers: this._headers((extra.headers as Record<string, string>) || {}) };

    if (body) options.body = JSON.stringify(body);

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
      if ((err as Error).name === 'AbortError') {
        throw new Error(`Devs.ai v2 API request timed out after ${timeoutMs}ms`, { cause: err });
      }
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Devs.ai v2 API error (${response.status}): ${errorText}`);
    }

    if (response.status === 204) return null as T;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) return response.json() as Promise<T>;
    const text = await response.text();
    if (!text) return null as T;
    try {
      return JSON.parse(text) as T;
    } catch {
      return { raw: text } as T;
    }
  }

  /* ── LlmClient: non-streaming completion (jobs, test-chat) ── */

  async chatCompletion(
    model: string,
    messages: ChatMessage[],
    options: Record<string, unknown> = {},
  ): Promise<ChatCompletionResponse> {
    const { timeoutMs, ...rest } = options;
    const body = messagesToV2Request(model, messages, { ...rest, stream: false });
    const data = await this._request<V2ResponseObject>('POST', '/api/v2/responses', body, { timeoutMs });

    const content = extractV2ResponseText(data);
    const usage = mapV2Usage(data.usage);

    if (!String(content || '').trim() && data.status === 'failed') {
      throw new Error(data.error?.message || 'Devs.ai v2 response failed');
    }

    return {
      model: data.model || model,
      choices: [{ message: { role: 'assistant', content }, finish_reason: data.status === 'completed' ? 'stop' : null }],
      usage,
      raw: data,
    };
  }

  /* ── LlmClient: streaming completion (chat model path) ── */

  async chatCompletionStream(
    model: string,
    messages: ChatMessage[],
    options: Record<string, unknown> = {},
  ): Promise<globalThis.Response> {
    const { timeoutMs, ...rest } = options;
    const body = messagesToV2Request(model, messages, { ...rest, stream: true });

    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (timeoutMs && (timeoutMs as number) > 0) {
      controller = new AbortController();
      timer = setTimeout(() => controller?.abort(), timeoutMs as number);
    }

    let upstream: globalThis.Response;
    try {
      upstream = await fetch(`${this.baseUrl}/api/v2/responses`, {
        method: 'POST',
        headers: this._headers({ Accept: 'text/event-stream' }),
        body: JSON.stringify(body),
        signal: controller?.signal,
      });
    } catch (err: unknown) {
      if (timer) clearTimeout(timer);
      if ((err as Error).name === 'AbortError') {
        throw new Error(`Devs.ai v2 streaming timed out after ${timeoutMs}ms`, { cause: err });
      }
      throw err;
    }

    if (!upstream.ok) {
      if (timer) clearTimeout(timer);
      const errorText = await upstream.text();
      throw new Error(`Devs.ai v2 streaming error (${upstream.status}): ${errorText}`);
    }

    return this._wrapUpstreamSse(upstream, { timer, controller });
  }

  /* ── v2-native methods (Phase B/C) ─────────────────────── */

  async createResponse(body: Record<string, unknown>, options: { timeoutMs?: number } = {}): Promise<V2ResponseObject> {
    return this._request<V2ResponseObject>('POST', '/api/v2/responses', body, options);
  }

  async getResponse(responseId: string): Promise<V2ResponseObject> {
    return this._request<V2ResponseObject>('GET', `/api/v2/responses/${responseId}`);
  }

  async cancelResponse(responseId: string): Promise<void> {
    await this._request('POST', `/api/v2/responses/${responseId}/cancel`);
  }

  async resumeResponse(
    responseId: string,
    toolOutputs?: Array<{ tool_call_id: string; output: string }>,
    options: { timeoutMs?: number } = {},
  ): Promise<globalThis.Response> {
    const url = `${this.baseUrl}/api/v2/responses/${responseId}/resume`;
    let controller: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeoutMs = options.timeoutMs;
    if (timeoutMs && timeoutMs > 0) {
      controller = new AbortController();
      timer = setTimeout(() => controller?.abort(), timeoutMs);
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: this._headers({ Accept: 'text/event-stream' }),
      body: JSON.stringify({ tool_outputs: toolOutputs || [] }),
      signal: controller?.signal,
    });

    if (!response.ok) {
      if (timer) clearTimeout(timer);
      const errorText = await response.text();
      throw new Error(`Devs.ai v2 resume error (${response.status}): ${errorText}`);
    }

    return this._wrapUpstreamSse(response, { timer, controller });
  }

  /** Resume with tool outputs and re-emit SSE in chat-compatible shape. */
  async resumeResponseStream(
    responseId: string,
    toolOutputs: Array<{ tool_call_id: string; output: string }>,
    options: { timeoutMs?: number } = {},
  ): Promise<globalThis.Response> {
    return this.resumeResponse(responseId, toolOutputs, options);
  }

  private _wrapUpstreamSse(
    upstream: globalThis.Response,
    abort: { timer?: ReturnType<typeof setTimeout>; controller?: AbortController },
  ): globalThis.Response {
    const state = createSseTransformState();
    const lineBuffer = { value: '' };
    const upstreamBody = upstream.body;
    if (!upstreamBody) {
      throw new Error('Devs.ai v2 streaming response has no body');
    }

    const reader = upstreamBody.getReader();
    const decoder = new TextDecoder();

    const transformedStream = new ReadableStream<Uint8Array>({
      async pull(ctrl) {
        try {
          while (true) {
            const { value, done } = await reader.read();
            if (done) {
              if (lineBuffer.value.trim()) {
                const remainder = transformV2SseChunk(`${lineBuffer.value}\n`, state, { value: '' });
                if (remainder) ctrl.enqueue(new TextEncoder().encode(remainder));
              }
              if (!state.fullText) {
                ctrl.enqueue(
                  new TextEncoder().encode(
                    `data: ${JSON.stringify({
                      type: 'message.complete',
                      text: '',
                      inputTokens: state.inputTokens,
                      outputTokens: state.outputTokens,
                      responseId: state.responseId,
                      conversationId: state.conversationId,
                      lastSequence: state.lastSequence,
                    })}\n\n`,
                  ),
                );
              }
              ctrl.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));
              ctrl.close();
              return;
            }
            const chunk = decoder.decode(value, { stream: true });
            const out = transformV2SseChunk(chunk, state, lineBuffer);
            if (out) {
              ctrl.enqueue(new TextEncoder().encode(out));
              return;
            }
          }
        } catch (err) {
          ctrl.error(err);
        }
      },
      cancel() {
        reader.cancel().catch(() => {});
      },
    });

    const response = new Response(transformedStream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }) as PatchedResponse;

    response._abortTimer = abort.timer;
    response._abortController = abort.controller;
    return response;
  }

  /** Connectivity test — minimal stateless response. */
  async ping(model: string): Promise<{ ok: boolean; responseId?: string }> {
    const data = await this.createResponse({
      model,
      input: 'Reply with exactly: OK',
      stream: false,
      store: false,
      max_output_tokens: 16,
    });
    return { ok: data.status === 'completed', responseId: data.id };
  }

  /** List models via v1 endpoint (shared platform). */
  async listModels(): Promise<string[]> {
    try {
      const payload = await this._request<unknown>('GET', '/api/v1/models');
      if (Array.isArray(payload)) return payload.map((r) => String((r as { id?: string }).id || r));
      const obj = payload as Record<string, unknown>;
      const data = Array.isArray(obj.data) ? obj.data : [];
      return data.map((r) => String((r as { id?: string }).id || ''));
    } catch {
      return [];
    }
  }
}

export function createDevsAiV2Client(config: { baseUrl: string; apiKey: string }): DevsAiV2Client {
  return new DevsAiV2Client(config.baseUrl, config.apiKey);
}
