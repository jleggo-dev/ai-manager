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
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; url: string }
  /**
   * A document the model reads whole (a PDF). Either a provider-side `fileId` (uploaded ahead
   * through `LlmClient.uploadFile` — the only way past the ~4.5 MB request-body ceiling) or
   * inline base64 `data` for something small. Providers map this to their dialect (Responses
   * `input_file`, OpenAI chat `file`); text-only clients drop it, as they drop images.
   */
  | { type: 'file'; filename: string; mimeType: string; fileId?: string; data?: string };

/** A document handed to a chat turn (`SendChatMessageOptions.files`). Text-bearing files ride as
 *  a labelled text block — no provider takes a `.csv` as a file part — everything else as a
 *  `file` content part by id or inline data. */
export interface ChatFileInput {
  filename: string;
  mimeType: string;
  /** Provider file id from `uploadChatSessionFile` (PDFs). */
  fileId?: string;
  /** Inline base64 (small PDFs only). */
  data?: string;
  /** Decoded text (.txt / .md / .csv). */
  text?: string;
}

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
  /**
   * Put a file on the provider ahead of a turn and get back the id a `file` content part
   * references. Optional: a client without it cannot take documents, and the engine says so
   * rather than inlining megabytes of base64 into a request body.
   */
  uploadFile?(file: { buffer: Buffer; filename: string; mimeType: string }): Promise<{ fileId: string }>;
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
