/**
 * Transform Devs.ai v2 Responses SSE events into shapes chat-sessions.ts already parses:
 *   - choices[0].delta.content for streaming deltas
 *   - message.complete with inputTokens/outputTokens/cachedInputTokens at end
 */

import type { V2StreamEvent } from './types.ts';
import { pushSseChunk, type SseLineBuffer } from '../../services/sse-line-reader.ts';

export interface SseTransformState {
  fullText: string;
  inputTokens: number | null;
  outputTokens: number | null;
  /**
   * How many of `inputTokens` the provider served from its prompt cache.
   *
   * The field has been in `V2Usage` all along (`input_tokens_details.cached_tokens`, the OpenAI
   * Responses shape) and nothing has ever read it — so we have never known whether a discount was
   * already being applied. It matters because a coach turn carries a byte-identical ~9,600-token
   * prefix (persona + tool definitions) on EVERY message, which is exactly the shape an
   * automatic prefix cache is for. Without this number, a measured "22,869 tokens/turn" cannot be
   * told apart from a billed one, and any cost work would be guessing at its own baseline.
   *
   * `null` means the provider said nothing; `0` means it said nothing was cached. Those are
   * different answers and the difference is the whole point — a `0` proves the pass-through works
   * and the prefix simply is not being reused, which is an entirely different problem from silence.
   */
  cachedInputTokens: number | null;
  model: string | null;
  responseId: string | null;
  conversationId: string | null;
  lastSequence: number | null;
}

export function createSseTransformState(): SseTransformState {
  return {
    fullText: '',
    inputTokens: null,
    cachedInputTokens: null,
    outputTokens: null,
    model: null,
    responseId: null,
    conversationId: null,
    lastSequence: null,
  };
}

/** Parse one v2 SSE data line; return OpenAI-chat-compatible lines to forward (may be empty). */
export function transformV2SseDataLine(dataStr: string, state: SseTransformState): string[] {
  if (!dataStr || dataStr === '[DONE]') return ['data: [DONE]\n\n'];

  let parsed: V2StreamEvent;
  try {
    parsed = JSON.parse(dataStr) as V2StreamEvent;
  } catch {
    return [];
  }

  const out: string[] = [];
  const eventType = parsed.type || '';

  if (parsed.sequence_number != null) state.lastSequence = parsed.sequence_number;

  if (eventType === 'response.created' && parsed.response?.id) {
    state.responseId = parsed.response.id;
    const conv = (parsed.response as { conversation?: { id?: string } | string }).conversation;
    if (typeof conv === 'string') state.conversationId = conv;
    else if (conv && typeof conv === 'object' && conv.id) state.conversationId = conv.id;
    out.push(`data: ${JSON.stringify({ type: 'v2.response.created', responseId: parsed.response.id })}\n\n`);
    return out;
  }

  /* Text deltas — v2 uses response.output_text.delta */
  if (eventType === 'response.output_text.delta' && parsed.delta) {
    state.fullText += parsed.delta;
    out.push(`data: ${JSON.stringify({ choices: [{ delta: { content: parsed.delta } }] })}\n\n`);
    return out;
  }

  if (eventType === 'response.output_text.done' && parsed.text) {
    if (!state.fullText) state.fullText = parsed.text;
    return out;
  }

  /* Completed response with usage */
  if (eventType === 'response.completed' || eventType === 'response.done') {
    const usage = parsed.response?.usage || parsed.usage;
    if (usage?.input_tokens != null) state.inputTokens = usage.input_tokens;
    /**
     * Assigned from THIS usage block including its ABSENCE, which is why it is not guarded the way
     * `input_tokens` is.
     *
     * The guard it replaces ("a provider that omits the detail block leaves this null") was true of
     * a fresh state and false of a reused one. Upstream emits both `response.completed` AND
     * `response.done` for one response, and the second carries `input_tokens: 0` with no detail
     * block — so the old `if (cached != null)` kept the FIRST event's figure and re-emitted it
     * beside a zero prompt. Captured off the wire:
     *
     *     message.complete{inputTokens:24081, cachedInputTokens:15255} resp=4fc60fcb82c1
     *     message.complete{inputTokens:0,     cachedInputTokens:15255} resp=4fc60fcb82c1
     *
     * The consumer summed both and reported 30,510 cached against 24,081 prompt. A response that
     * reports usage and no cached detail cached nothing; say that, rather than repeating what the
     * last one cached. (`coach-stream` also counts each response once now — either fix alone closes
     * this case, and the pair also covers the duplicate that repeats input as well as cached.)
     */
    if (usage) state.cachedInputTokens = usage.input_tokens_details?.cached_tokens ?? null;
    if (usage?.output_tokens != null) state.outputTokens = usage.output_tokens;
    if (parsed.response?.model) state.model = parsed.response.model;
    if (parsed.response?.id) state.responseId = parsed.response.id;
    const conv = (parsed.response as { conversation?: { id?: string } | string } | undefined)?.conversation;
    if (typeof conv === 'string') state.conversationId = conv;
    else if (conv && typeof conv === 'object' && conv.id) state.conversationId = conv.id;

    const outputItems = parsed.response?.output;
    if (Array.isArray(outputItems)) {
      for (const raw of outputItems) {
        const item = raw as { type?: string; call_id?: string; id?: string; name?: string; arguments?: string };
        if (item?.type === 'function_call') {
          out.push(`data: ${JSON.stringify({ type: 'response.output_item.done', item })}\n\n`);
        }
      }
    }

    const text = state.fullText || parsed.text || '';
    out.push(
      `data: ${JSON.stringify({
        type: 'message.complete',
        text,
        inputTokens: state.inputTokens,
        outputTokens: state.outputTokens,
        cachedInputTokens: state.cachedInputTokens,
        modelId: state.model,
        responseId: state.responseId,
        conversationId: state.conversationId,
        lastSequence: state.lastSequence,
        output: outputItems,
      })}\n\n`,
    );
    out.push('data: [DONE]\n\n');
    return out;
  }

  if (eventType === 'response.failed') {
    const msg = parsed.response?.error?.message || 'Response failed';
    out.push(`data: ${JSON.stringify({ error: msg })}\n\n`);
    out.push('data: [DONE]\n\n');
    return out;
  }

  /* v2 function_call events — forward for tool loop */
  if (
    eventType.includes('function_call') ||
    eventType === 'response.output_item.added' ||
    eventType === 'response.output_item.done'
  ) {
    const { type: _ignored, ...rest } = parsed;
    out.push(`data: ${JSON.stringify({ type: eventType, ...rest })}\n\n`);
  }

  return out;
}

/** Transform a raw SSE chunk from v2 into OpenAI-compatible SSE text. */
export function transformV2SseChunk(chunk: string, state: SseTransformState, lineBuffer: SseLineBuffer): string {
  const lines = pushSseChunk(lineBuffer, chunk);

  const output: string[] = [];
  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    const dataStr = line.slice(6).trim();
    output.push(...transformV2SseDataLine(dataStr, state));
  }
  return output.join('');
}
