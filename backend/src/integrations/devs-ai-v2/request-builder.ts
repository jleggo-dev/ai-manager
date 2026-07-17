import type { ChatMessage } from "../../types.ts";
import { contentText } from "../../lib/message-content.ts";
import {
  expectedSchemaFieldsToJsonSchema,
  type ExpectedSchemaInput,
} from "../../services/expected-schema-to-json-schema.ts";

export interface V2CreateResponseBody {
  input: string | unknown[];
  model: string;
  instructions?: string;
  stream: boolean;
  tools?: unknown[];
  parallel_tool_calls?: boolean;
  chat_mode?: string;
  thread_mode?: string;
  previous_response_id?: string;
  conversation?: string | { id: string };
  text?: Record<string, unknown>;
  temperature?: number;
  max_output_tokens?: number;
  store?: boolean;
}

/**
 * Split chat messages into v2 instructions (system) + user/assistant input items.
 */
export function messagesToV2Request(
  model: string,
  messages: ChatMessage[],
  options: Record<string, unknown> = {},
): V2CreateResponseBody {
  const systemParts: string[] = [];
  const inputItems: Array<Record<string, unknown>> = [];
  let assistantItemSeq = 0;

  for (const msg of messages) {
    if (msg.role === "system") {
      // System messages are text-only in the Responses dialect; image parts (if any) are dropped.
      systemParts.push(contentText(msg.content));
    } else if (msg.role === "assistant") {
      // v2 accepts a bare {role, content: string} item for a NEW user turn, but a replayed
      // assistant/model-output item (multi-turn chat history) must carry the full "message"
      // item shape — id + status + content as parts — or the API 400s with e.g.
      // "input[N].id: expected string, received undefined". There's no real prior response id
      // to reference here (this is a persisted chat-history row, not a live tool-call chain),
      // so a synthetic id + status "completed" satisfies validation for plain-text replay.
      inputItems.push({
        type: "message",
        role: "assistant",
        id: `hist_asst_${assistantItemSeq++}`,
        status: "completed",
        content: [{ type: "output_text", text: contentText(msg.content) }],
      });
    } else if (typeof msg.content === "string") {
      inputItems.push({ role: msg.role, content: msg.content });
    } else {
      // Multimodal user turn → Responses content parts (vision).
      inputItems.push({
        role: msg.role,
        content: msg.content.map((p) =>
          p.type === "text"
            ? { type: "input_text", text: p.text }
            : { type: "input_image", image_url: p.url },
        ),
      });
    }
  }

  const instructions = [
    systemParts.join("\n\n"),
    options.instructions as string | undefined,
  ]
    .filter(Boolean)
    .join("\n\n");

  const body: V2CreateResponseBody = {
    model,
    stream: Boolean(options.stream),
    input:
      // The bare-string shortcut only applies to a single PLAIN-TEXT user turn; a parts
      // array must stay inside an input-items array or the API rejects the body.
      inputItems.length === 1 &&
      inputItems[0]?.role === "user" &&
      typeof inputItems[0].content === "string"
        ? (inputItems[0].content as string)
        : inputItems,
    store: options.store !== false,
  };

  if (instructions) body.instructions = instructions;
  if (options.tools)
    body.tools = normalizeToolsForV2(options.tools as unknown[]);
  if (options.parallel_tool_calls != null)
    body.parallel_tool_calls = Boolean(options.parallel_tool_calls);
  if (options.chat_mode) body.chat_mode = String(options.chat_mode);
  if (options.thread_mode) body.thread_mode = String(options.thread_mode);
  if (options.previous_response_id)
    body.previous_response_id = String(options.previous_response_id);
  if (options.conversation)
    body.conversation = options.conversation as string | { id: string };
  if (options.temperature != null)
    body.temperature = Number(options.temperature);
  if (options.max_output_tokens != null)
    body.max_output_tokens = Number(options.max_output_tokens);

  /* Native structured output from expectedSchema or pre-built text.format */
  if (options.text && typeof options.text === "object") {
    body.text = options.text as Record<string, unknown>;
  } else if (options.expectedSchema) {
    const schemaFormat = expectedSchemaFieldsToJsonSchema(
      options.expectedSchema as ExpectedSchemaInput,
    );
    if (schemaFormat) body.text = schemaFormat;
  }

  return body;
}

/** Flatten Chat Completions-style `{ type, function: { name, ... } }` for Responses API v2. */
export function normalizeToolsForV2(tools: unknown[]): unknown[] {
  return tools.map((tool) => {
    if (!tool || typeof tool !== "object") return tool;
    const row = tool as Record<string, unknown>;
    if (
      row.type === "function" &&
      row.function &&
      typeof row.function === "object"
    ) {
      const fn = row.function as Record<string, unknown>;
      return {
        type: "function",
        name: fn.name,
        description: fn.description,
        parameters: fn.parameters,
      };
    }
    return tool;
  });
}

/** Extract assistant text from a completed v2 Response object. */
export function extractV2ResponseText(response: {
  output?: Array<{
    type?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
}): string {
  const parts: string[] = [];
  for (const item of response.output || []) {
    if (item.type !== "message") continue;
    for (const part of item.content || []) {
      if (part.type === "output_text" && part.text) parts.push(part.text);
    }
  }
  return parts.join("");
}

/** Map v2 usage to OpenAI-compatible usage shape. */
export function mapV2Usage(
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
    total_tokens:
      usage.total_tokens ??
      ((usage.input_tokens || 0) + (usage.output_tokens || 0) || null),
  };
}
