export interface ChatCompletionUsage {
  prompt_tokens: number | null;
  completion_tokens: number | null;
  total_tokens: number | null;
}

export interface ChatCompletionChoice {
  message: { content: string };
  finish_reason: string | null;
}

export interface ChatCompletionResponse {
  model?: string;
  choices: ChatCompletionChoice[];
  usage: ChatCompletionUsage | null;
  raw?: unknown;
}

/**
 * One part of a multimodal chat message. `image_url` must be an https URL the provider can
 * fetch (e.g. a short-lived signed URL) — never inline base64 (keeps requests small and
 * diagnostics log URL references instead of blobs). Providers map this canonical shape to
 * their own dialect (OpenAI-compat `image_url:{url}`, Responses `input_image`, etc.).
 */
export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; url: string };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  /** Plain string for text-only messages (the overwhelmingly common case); parts for vision. */
  content: string | ContentPart[];
}

export interface LlmClient {
  chatCompletion(
    model: string,
    messages: ChatMessage[],
    options?: Record<string, unknown>,
  ): Promise<ChatCompletionResponse>;
  chatCompletionStream?(
    model: string,
    messages: ChatMessage[],
    options?: Record<string, unknown>,
  ): Promise<globalThis.Response>;
}

export interface PatchedResponse extends globalThis.Response {
  _abortTimer?: ReturnType<typeof setTimeout>;
  _abortController?: AbortController;
}

export interface FormattingRule {
  type: string;
  order?: number;
  options?: Record<string, unknown>;
}

export interface FormattingResult {
  formatted: string;
  steps: FormattingStep[];
}

export interface FormattingStep {
  type: string;
  label?: string;
  before: number;
  after: number;
  changed?: boolean;
  error?: string;
  rolledBack?: boolean;
  warning?: string;
}

export interface AiManagerResult {
  raw: string;
  formatted: string;
  formattingSteps: FormattingStep[];
  messageSent: string;
  metadata: {
    durationMs: number;
    model: string;
    usage: ChatCompletionUsage | null;
    finishReason: string | null;
    jobSlug: string | null;
    jobName: string | null;
    aiProfile: string;
    provider: string;
  };
  diagnostics?: unknown;
}

export interface Attachment {
  url: string;
  mimeType: string;
  fileName: string;
}
