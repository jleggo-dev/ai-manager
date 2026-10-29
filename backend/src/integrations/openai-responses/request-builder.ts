/**
 * OpenAI Responses dialect — the request shape shared by every provider that speaks it.
 *
 * Devs.ai v2 and Vercel AI Gateway both take `POST …/responses` with `input` items,
 * `instructions`, `tools` and `text.format`. What differs is the extensions: Devs.ai adds
 * `chat_mode` / `thread_mode` and a file store; the gateway has neither. This module holds the
 * common part so both clients build the same body from the same chat messages, and a fix here is
 * a fix for both. Provider-specific fields are layered on by the provider's own builder.
 */
import type { ChatMessage, ContentPart } from '../../types.ts';
import { contentText } from '../../lib/message-content.ts';
import {
  expectedSchemaFieldsToJsonSchema,
  type ExpectedSchemaInput,
} from '../../services/expected-schema-to-json-schema.ts';

export interface ResponsesCreateBody {
  input: string | unknown[];
  model: string;
  instructions?: string;
  stream: boolean;
  tools?: unknown[];
  parallel_tool_calls?: boolean;
  previous_response_id?: string;
  conversation?: string | { id: string };
  text?: Record<string, unknown>;
  temperature?: number;
  max_output_tokens?: number;
  store?: boolean;
}

/**
 * One canonical content part → the Responses `InputContentPart` union (`input_text` /
 * `input_image` / `input_file`). A `file` part rides by `file_id` when it was uploaded ahead
 * (a provider with a file store), else as inline `file_data` — a data URL, which is what
 * OpenAI's own `input_file` takes.
 */
export function toInputContentPart(p: ContentPart): Record<string, unknown> {
  if (p.type === 'text') return { type: 'input_text', text: p.text };
  if (p.type === 'image_url') return { type: 'input_image', image_url: p.url };
  return {
    type: 'input_file',
    filename: p.filename,
    ...(p.fileId ? { file_id: p.fileId } : {}),
    ...(p.data ? { file_data: `data:${p.mimeType};base64,${p.data}` } : {}),
  };
}

/** Flatten Chat Completions-style `{ type, function: { name, ... } }` for the Responses API. */
export function normalizeToolsForResponses(tools: unknown[]): unknown[] {
  return tools.map((tool) => {
    if (!tool || typeof tool !== 'object') return tool;
    const row = tool as Record<string, unknown>;
    if (row.type === 'function' && row.function && typeof row.function === 'object') {
      const fn = row.function as Record<string, unknown>;
      return {
        type: 'function',
        name: fn.name,
        description: fn.description,
        parameters: fn.parameters,
      };
    }
    return tool;
  });
}

/**
 * Split chat messages into Responses `instructions` (system) + user/assistant input items, and
 * carry the standard options across. Provider extensions are NOT read here.
 */
export function buildResponsesRequest(
  model: string,
  messages: ChatMessage[],
  options: Record<string, unknown> = {},
): ResponsesCreateBody {
  const systemParts: string[] = [];
  const inputItems: Array<Record<string, unknown>> = [];
  let assistantItemSeq = 0;

  for (const msg of messages) {
    if (msg.role === 'system') {
      // System messages are text-only in the Responses dialect; image parts (if any) are dropped.
      systemParts.push(contentText(msg.content));
    } else if (msg.role === 'assistant') {
      // A replayed assistant item (multi-turn chat history) must carry the full "message" item
      // shape — id + status + content as parts — or the API 400s with e.g.
      // "input[N].id: expected string, received undefined". There's no real prior response id
      // to reference here (this is a persisted chat-history row, not a live tool-call chain),
      // so a synthetic id + status "completed" satisfies validation for plain-text replay.
      inputItems.push({
        type: 'message',
        role: 'assistant',
        id: `hist_asst_${assistantItemSeq++}`,
        status: 'completed',
        content: [{ type: 'output_text', text: contentText(msg.content) }],
      });
    } else if (typeof msg.content === 'string') {
      inputItems.push({ role: msg.role, content: msg.content });
    } else {
      // Multimodal user turn → Responses content parts (vision + documents).
      inputItems.push({ role: msg.role, content: msg.content.map(toInputContentPart) });
    }
  }

  const instructions = [systemParts.join('\n\n'), options.instructions as string | undefined]
    .filter(Boolean)
    .join('\n\n');

  const body: ResponsesCreateBody = {
    model,
    stream: Boolean(options.stream),
    input:
      // The bare-string shortcut only applies to a single PLAIN-TEXT user turn; a parts
      // array must stay inside an input-items array or the API rejects the body.
      inputItems.length === 1 && inputItems[0]?.role === 'user' && typeof inputItems[0].content === 'string'
        ? (inputItems[0].content as string)
        : inputItems,
    store: options.store !== false,
  };

  if (instructions) body.instructions = instructions;
  if (options.tools) body.tools = normalizeToolsForResponses(options.tools as unknown[]);
  if (options.parallel_tool_calls != null) body.parallel_tool_calls = Boolean(options.parallel_tool_calls);
  if (options.previous_response_id) body.previous_response_id = String(options.previous_response_id);
  if (options.conversation) body.conversation = options.conversation as string | { id: string };
  if (options.temperature != null) body.temperature = Number(options.temperature);
  if (options.max_output_tokens != null) body.max_output_tokens = Number(options.max_output_tokens);

  /* Native structured output from expectedSchema or pre-built text.format */
  if (options.text && typeof options.text === 'object') {
    body.text = options.text as Record<string, unknown>;
  } else if (options.expectedSchema) {
    const schemaFormat = expectedSchemaFieldsToJsonSchema(options.expectedSchema as ExpectedSchemaInput);
    if (schemaFormat) body.text = schemaFormat;
  }

  return body;
}

/** Extract assistant text from a completed Response object. */
export function extractResponseText(response: {
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
}): string {
  const parts: string[] = [];
  for (const item of response.output || []) {
    if (item.type !== 'message') continue;
    for (const part of item.content || []) {
      if (part.type === 'output_text' && part.text) parts.push(part.text);
    }
  }
  return parts.join('');
}

/** Map Responses usage to the OpenAI Chat Completions usage shape the engine records. */
export function mapResponsesUsage(
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
  } | null,
) {
  if (!usage) return null;
  return {
    prompt_tokens: usage.input_tokens ?? null,
    completion_tokens: usage.output_tokens ?? null,
    total_tokens: usage.total_tokens ?? ((usage.input_tokens || 0) + (usage.output_tokens || 0) || null),
  };
}
