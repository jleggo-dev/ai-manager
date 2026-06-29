/**
 * @ai-admin/client — typed HTTP client for AI Admin API.
 */

export interface AiAdminClientOptions {
  baseUrl: string;
  apiKey: string;
  /** Append /_/backend for Vercel deploys unless localhost */
  normalizeVercel?: boolean;
}

export interface SseEvent {
  type?: string;
  content?: string;
  delta?: string;
  text?: string;
  choices?: Array<{ delta?: { content?: string } }>;
  [key: string]: unknown;
}

export class AiAdminClient {
  private readonly apiBase: string;
  private readonly apiKey: string;

  constructor(options: AiAdminClientOptions) {
    const raw = options.baseUrl.replace(/\/+$/, '');
    this.apiBase =
      options.normalizeVercel === false
        ? raw
        : raw.includes('/_/backend') || raw.includes('localhost')
          ? raw
          : `${raw}/_/backend`;
    this.apiKey = options.apiKey;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      'Content-Type': 'application/json',
      ...extra,
    };
  }

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.apiBase}${path}`, {
      method,
      headers: this.headers(),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`AI Admin ${method} ${path} failed (${res.status}): ${errText}`);
    }
    return res.json() as Promise<T>;
  }

  runProcessingJobTest(
    jobId: string,
    body: { variables?: Record<string, unknown>; callingApplication: string },
    idempotencyKey?: string,
  ) {
    return this.requestWithIdempotency('POST', `/api/processing-jobs/${jobId}/test`, body, idempotencyKey);
  }

  async requestWithIdempotency<T>(
    method: string,
    path: string,
    body: unknown,
    idempotencyKey?: string,
  ): Promise<T> {
    const res = await fetch(`${this.apiBase}${path}`, {
      method,
      headers: this.headers(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`AI Admin ${method} ${path} failed (${res.status}): ${errText}`);
    }
    return res.json() as Promise<T>;
  }

  /** Parse SSE text into events; stops at [DONE]. */
  static parseSseText(text: string): { events: SseEvent[]; content: string; done: boolean } {
    const events: SseEvent[] = [];
    let content = '';
    let done = false;

    for (const line of text.split('\n')) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') {
        done = true;
        break;
      }
      try {
        const parsed = JSON.parse(data) as SseEvent;
        events.push(parsed);
        const delta =
          parsed.choices?.[0]?.delta?.content ||
          parsed.text ||
          parsed.delta ||
          parsed.content ||
          '';
        if (typeof delta === 'string') content += delta;
        if (parsed.type === 'formatted_response' && typeof parsed.content === 'string') {
          content = parsed.content;
        }
      } catch {
        /* non-JSON SSE line */
      }
    }

    return { events, content, done };
  }
}
