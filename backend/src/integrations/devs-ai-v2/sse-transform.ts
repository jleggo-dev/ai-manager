/**
 * Transform Devs.ai v2 Responses SSE events into shapes chat-sessions.ts already parses:
 *   - choices[0].delta.content for streaming deltas
 *   - message.complete with inputTokens/outputTokens at end
 */

import type { V2StreamEvent } from './types.ts';
import { pushSseChunk, type SseLineBuffer } from '../../services/sse-line-reader.ts';

export interface SseTransformState {
  fullText: string;
  inputTokens: number | null;
  outputTokens: number | null;
  model: string | null;
  responseId: string | null;
  conversationId: string | null;
  lastSequence: number | null;
}

export function createSseTransformState(): SseTransformState {
  return {
    fullText: '',
    inputTokens: null,
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
