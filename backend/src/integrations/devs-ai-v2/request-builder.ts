import type { ChatMessage } from '../../types.ts';
import { contentText } from '../../lib/message-content.ts';
import {
  expectedSchemaFieldsToJsonSchema,
  type ExpectedSchemaInput,
} from '../../services/expected-schema-to-json-schema.ts';

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
 * The tool-call CONTINUATION request — THREADED form. Superseded; kept for the non-Cadence
 * caller in routes/chat-sessions and for the regression test that pins why it was abandoned.
 *
 * Live-probed 2026-08-14 (probe-tool-loop.ts): a v2 response arrives `completed` WITH its
 * function_call in the output array, and POST /responses/{id}/resume on that terminal response
 * 409s ("Response … is already terminal") — /resume serves Devs.ai's own paused interactive
 * tools, not function calling. So the continuation is a NEW response, threaded on
 * `previous_response_id`, whose input items are the function results.
 *
 * That much is true. What is NOT true is that the thread carries the conversation. Measured
 * 2026-08-16 against the deployed coach: round 1 billed 18,979 input tokens, rounds 2-4 billed
 * **12,772 — identical to the byte, three times running**, with byte-identical tool arguments. A
 * token count that does not move by one across three separate requests is a prompt that did not
 * change: Devs.ai returns 200, drops our `function_call_output`, and rebuilds the model input
 * from its own stored thread, which these items never join. The 6,207-token drop is the dossier
 * and the instructions going missing. No tool result has ever reached the model through here.
 *
 * CORRECTION (2026-08-20, reading the published spec): the instructions half of that drop is
 * DOCUMENTED behaviour, not a provider fault — "when used with previous_response_id, instructions
 * from the previous response are not carried over", i.e. a threaded caller must re-send them every
 * turn. The items-dropped half stands on the byte-identical token counts. Thread-mode
 * (thread-mode.ts, flag-gated) threads the MAIN turns and re-sends instructions each time;
 * continuations stay self-contained below for exactly the reason this comment records.
 *
 * `toolResultsToV2Request` below is the replacement: self-contained, nothing threaded, the whole
 * exchange in `input`.
 */
export function toolOutputsToV2Request(
  model: string,
  previousResponseId: string,
  outputs: Array<{ toolCallId: string; output: string }>,
  options: Record<string, unknown> = {},
): V2CreateResponseBody {
  const body: V2CreateResponseBody = {
    model,
    stream: Boolean(options.stream ?? true),
    previous_response_id: previousResponseId,
    input: outputs.map((o) => ({ type: 'function_call_output', call_id: o.toolCallId, output: o.output })),
    store: options.store !== false,
  };
  if (options.tools) body.tools = normalizeToolsForV2(options.tools as unknown[]);
  if (options.chat_mode) body.chat_mode = String(options.chat_mode);
  if (options.thread_mode) body.thread_mode = String(options.thread_mode);
  return body;
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
    if (msg.role === 'system') {
      // System messages are text-only in the Responses dialect; image parts (if any) are dropped.
      systemParts.push(contentText(msg.content));
    } else if (msg.role === 'assistant') {
      // v2 accepts a bare {role, content: string} item for a NEW user turn, but a replayed
      // assistant/model-output item (multi-turn chat history) must carry the full "message"
      // item shape — id + status + content as parts — or the API 400s with e.g.
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
      // Multimodal user turn → Responses content parts (vision).
      inputItems.push({
        role: msg.role,
        content: msg.content.map((p) =>
          p.type === 'text' ? { type: 'input_text', text: p.text } : { type: 'input_image', image_url: p.url },
        ),
      });
    }
  }

  const instructions = [systemParts.join('\n\n'), options.instructions as string | undefined]
    .filter(Boolean)
    .join('\n\n');

  const body: V2CreateResponseBody = {
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
  if (options.tools) body.tools = normalizeToolsForV2(options.tools as unknown[]);
  if (options.parallel_tool_calls != null) body.parallel_tool_calls = Boolean(options.parallel_tool_calls);
  if (options.chat_mode) body.chat_mode = String(options.chat_mode);
  if (options.thread_mode) body.thread_mode = String(options.thread_mode);
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

/** One fulfilled call: what the model asked for, and what it got back. */
export interface V2ToolExchange {
  toolCallId: string;
  name: string;
  /** The model's own JSON, echoed back verbatim — this is a replay, not a re-issue. */
  arguments?: string;
  output: string;
}

/**
 * The tool-call continuation, SELF-CONTAINED. Replaces the threaded form above (#232).
 *
 * Nothing is threaded and nothing is assumed about what the provider kept: the request carries
 * the conversation we hold in our own database, then the tool exchange, in order. That is the
 * shape `sendChatMessage` has always used and the only one measurably proven to arrive intact —
 * `messagesToV2Request` builds the history half here so there is exactly one implementation of
 * it, and a fix to one is a fix to both.
 *
 * The `function_call` item is echoed beside its output on purpose. In the Responses dialect an
 * unthreaded `function_call_output` is an orphan — a result to a question that is not in the
 * request — so the pair travels together, keyed by the model's own `call_id`. Every round's
 * exchange rides, not just the newest, because round three must still be able to see what round
 * one asked and learned.
 */
export function toolResultsToV2Request(
  model: string,
  messages: ChatMessage[],
  exchange: V2ToolExchange[],
  options: Record<string, unknown> = {},
): V2CreateResponseBody {
  // previous_response_id is deliberately dropped: threading is what swallowed the results.
  const { previous_response_id: _threaded, conversation: _conv, ...rest } = options;
  const body = messagesToV2Request(model, messages, { ...rest, stream: options.stream ?? true });

  const items: unknown[] = Array.isArray(body.input)
    ? [...body.input]
    : [{ role: 'user', content: String(body.input) }];

  exchange.forEach((e, i) => {
    items.push({
      type: 'function_call',
      id: `fc_replay_${i}`,
      status: 'completed',
      call_id: e.toolCallId,
      name: e.name,
      arguments: e.arguments ?? '{}',
    });
    items.push({ type: 'function_call_output', call_id: e.toolCallId, output: e.output });
  });

  body.input = items;
  return body;
}

/** Flatten Chat Completions-style `{ type, function: { name, ... } }` for Responses API v2. */
export function normalizeToolsForV2(tools: unknown[]): unknown[] {
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

/** Extract assistant text from a completed v2 Response object. */
export function extractV2ResponseText(response: {
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
    total_tokens: usage.total_tokens ?? ((usage.input_tokens || 0) + (usage.output_tokens || 0) || null),
  };
}
