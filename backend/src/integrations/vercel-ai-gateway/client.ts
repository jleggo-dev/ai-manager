/**
 * Vercel AI Gateway client — provider type `vercel-ai-gateway`.
 *
 * Speaks the OpenAI Responses dialect at `POST {base}/responses`, so it reuses the shared
 * request builder. Differences from Devs.ai v2 that matter here:
 *   - model ids are `vendor/model` (`openai/gpt-4.1-mini`, `anthropic/claude-sonnet-5.5`) and
 *     pass through untouched;
 *   - nothing is stored server-side (`store: false` on every call), so there is no threading,
 *     no file store (no `uploadFile` — the engine then declines documents instead of inlining
 *     megabytes), and no remote purge;
 *   - strict `json_schema` is ENFORCED on GPT and Claude (Devs.ai ignores it), so the schema is
 *     closed or sent non-strict before it goes out (`request.ts`).
 *
 * Streaming is NOT supported yet: `chatCompletionStream` throws a plain error rather than
 * hanging, so a chat session pointed at this type fails on its first turn with a message that
 * says so. The coach's streaming path moves later, after the stream-transform and Claude-caching
 * work (docs/cadence/AI-GATEWAY-EVALUATION.md).
 */
import type { ChatMessage, ChatCompletionResponse } from '../../types.ts';
import { extractResponseText, mapResponsesUsage } from '../openai-responses/request-builder.ts';
import { buildGatewayRequest } from './request.ts';

/** The gateway's OpenAI-compatible origin; the Providers form offers it as the default. */
export const VERCEL_AI_GATEWAY_BASE_URL = 'https://ai-gateway.vercel.sh/v1';

export const STREAMING_NOT_SUPPORTED_MESSAGE =
  'Streaming is not supported yet on vercel-ai-gateway — point chat sessions at a devs-ai-v2 profile; jobs (non-streaming) run fine';

interface GatewayResponseObject {
  id?: string;
  status?: string;
  model?: string;
  output?: Array<{ type?: string; content?: Array<{ type?: string; text?: string }> }>;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
  error?: { code?: string; message?: string };
}

export interface GatewayModelRow {
  id: string;
  name?: string;
  pricing?: Record<string, unknown>;
}

export class VercelAiGatewayClient {
  baseUrl: string;
  apiKey: string;

  constructor(baseUrl: string, apiKey: string) {
    this.baseUrl = (baseUrl || VERCEL_AI_GATEWAY_BASE_URL).replace(/\/+$/, '');
    this.apiKey = apiKey;
  }

  private headers(): Record<string, string> {
    return { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` };
  }

  private async request<T>(method: string, path: string, body: unknown, timeoutMs?: number): Promise<T> {
    const controller = timeoutMs && timeoutMs > 0 ? new AbortController() : undefined;
    const timer = controller ? setTimeout(() => controller.abort(), timeoutMs) : undefined;
    let response: globalThis.Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: this.headers(),
        ...(body ? { body: JSON.stringify(body) } : {}),
        ...(controller ? { signal: controller.signal } : {}),
      });
    } catch (err: unknown) {
      if ((err as Error).name === 'AbortError') {
        throw new Error(`Vercel AI Gateway request timed out after ${timeoutMs}ms`, { cause: err });
      }
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
    if (!response.ok) {
      throw new Error(`Vercel AI Gateway error (${response.status}): ${await response.text()}`);
    }
    return response.json() as Promise<T>;
  }

  /* ── LlmClient: non-streaming completion (jobs, liveness, test-chat) ── */

  async chatCompletion(
    model: string,
    messages: ChatMessage[],
    options: Record<string, unknown> = {},
  ): Promise<ChatCompletionResponse> {
    const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : undefined;
    const { body } = buildGatewayRequest(model, messages, options);
    const data = await this.request<GatewayResponseObject>('POST', '/responses', body, timeoutMs);

    const content = extractResponseText(data);
    if (!String(content || '').trim() && data.status === 'failed') {
      throw new Error(data.error?.message || 'Vercel AI Gateway response failed');
    }

    return {
      model: data.model || model,
      choices: [{ message: { content }, finish_reason: data.status === 'completed' ? 'stop' : null }],
      usage: mapResponsesUsage(data.usage),
      raw: data,
    };
  }

  /* ── LlmClient: streaming — not yet ── */

  async chatCompletionStream(): Promise<globalThis.Response> {
    throw new Error(STREAMING_NOT_SUPPORTED_MESSAGE);
  }

  /** Connectivity test — one minimal, unstored response. */
  async ping(model: string): Promise<{ ok: boolean; responseId?: string }> {
    const res = await this.chatCompletion(model, [{ role: 'user', content: 'Reply with exactly: OK' }], {
      max_output_tokens: 16,
    });
    const data = res.raw as GatewayResponseObject;
    return { ok: data?.status === 'completed', responseId: data?.id };
  }

  /** The gateway's catalogue, with the per-model prices it publishes. */
  async listModelCatalog(): Promise<GatewayModelRow[]> {
    const payload = await this.request<{ data?: unknown[] } | unknown[]>('GET', '/models', null);
    const rows = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [];
    return rows
      .map((r) => r as Record<string, unknown>)
      .filter((r) => r && typeof r.id === 'string' && r.id)
      .map((r) => ({
        id: String(r.id),
        ...(typeof r.name === 'string' ? { name: r.name } : {}),
        ...(r.pricing && typeof r.pricing === 'object' ? { pricing: r.pricing as Record<string, unknown> } : {}),
      }));
  }

  /** Model ids only — the shape `model-sync.ts` takes. Throws when the gateway cannot be reached. */
  async listModels(): Promise<string[]> {
    return (await this.listModelCatalog()).map((m) => m.id);
  }
}

export function createVercelAiGatewayClient(config: { baseUrl: string; apiKey: string }): VercelAiGatewayClient {
  return new VercelAiGatewayClient(config.baseUrl, config.apiKey);
}
