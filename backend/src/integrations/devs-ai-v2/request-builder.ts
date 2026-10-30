import type { ChatMessage } from '../../types.ts';
import {
  buildResponsesRequest,
  extractResponseText,
  mapResponsesUsage,
  normalizeToolsForResponses,
  toInputContentPart,
  type ResponsesCreateBody,
} from '../openai-responses/request-builder.ts';

/**
 * The Devs.ai v2 body: the shared OpenAI Responses shape
 * (`../openai-responses/request-builder.ts`) plus Devs.ai's own `chat_mode` / `thread_mode`.
 */
export interface V2CreateResponseBody extends ResponsesCreateBody {
  chat_mode?: string;
  thread_mode?: string;
}

/** Same names as before the split, so the stream, history and persona code read unchanged. */
export const toV2InputContentPart = toInputContentPart;
export const normalizeToolsForV2 = normalizeToolsForResponses;
export const extractV2ResponseText = extractResponseText;
export const mapV2Usage = mapResponsesUsage;

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
 * Split chat messages into v2 instructions (system) + user/assistant input items — the shared
 * Responses body — then add the Devs.ai extensions.
 */
export function messagesToV2Request(
  model: string,
  messages: ChatMessage[],
  options: Record<string, unknown> = {},
): V2CreateResponseBody {
  const body: V2CreateResponseBody = buildResponsesRequest(model, messages, options);
  if (options.chat_mode) body.chat_mode = String(options.chat_mode);
  if (options.thread_mode) body.thread_mode = String(options.thread_mode);
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
