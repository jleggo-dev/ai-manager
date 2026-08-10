/**
 * Coach SSE relay + accumulate (API-03 / CROSS-02 cadence half).
 *
 * Reads an upstream AI Admin chat stream, relays decoded text chunks to the
 * client while connected, and accumulates assistant content + usage across
 * both upstream frame shapes (OpenAI-style deltas and v2 `message.complete`).
 * Line buffering uses `@ai-admin/core`'s `createSseLineBuffer` (same contract
 * as backend BE-02) so TCP chunk-splits cannot drop mid-line JSON.
 */

import { createSseLineBuffer, pushSseChunk } from '@ai-admin/core';

/** Accumulated bookkeeping from one coach turn stream. */
export interface CoachStreamResult {
  content: string;
  promptTokens: number | null;
  completionTokens: number | null;
  model: string | null;
  responseId: string | null;
  firstTokenMs: number | null;
  clientDropped: boolean;
}

export interface RelayAndAccumulateOptions {
  /**
   * Write a decoded text chunk to the client. Return `false` (or throw) when
   * the client is gone so the relay stops while upstream draining continues.
   */
  writeChunk?: (chunk: string) => boolean | void;
  /** Optional alive check before each write (e.g. Express `close` flag). */
  isClientAlive?: () => boolean;
  /**
   * Fired ONCE, as soon as the stream names the upstream response. The Stop button needs the id of
   * the response that is generating right now, and it needs it mid-stream — by the time this
   * function returns, there is nothing left to stop.
   */
  onResponseId?: (responseId: string) => void;
}

/** Mutable accumulate state — shared by the stream loop and per-line parser. */
export interface CoachStreamAccumulateState {
  content: string;
  promptTokens: number | null;
  completionTokens: number | null;
  model: string | null;
  responseId: string | null;
}

export function createCoachStreamAccumulateState(): CoachStreamAccumulateState {
  return {
    content: '',
    promptTokens: null,
    completionTokens: null,
    model: null,
    responseId: null,
  };
}

/**
 * Apply one complete SSE `data:` payload (already stripped of the `data: `
 * prefix and trimmed). Ignores `[DONE]` and non-JSON keepalives.
 * Exported for characterization tests of both upstream frame shapes.
 */
export function applySseDataPayload(state: CoachStreamAccumulateState, data: string): void {
  if (data === '[DONE]') return;
  try {
    const p = JSON.parse(data) as Record<string, unknown>;
    const choices = p.choices as Array<{ delta?: { content?: unknown } }> | undefined;
    const delta = choices?.[0]?.delta?.content;
    if (typeof delta === 'string') state.content += delta;

    // OpenAI-style usage/model arrive on the final chunk (Devs.ai completion stream).
    const usage = p.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
    if (usage) {
      state.promptTokens = usage.prompt_tokens ?? state.promptTokens;
      state.completionTokens = usage.completion_tokens ?? state.completionTokens;
    }
    if (typeof p.model === 'string' && !state.model) state.model = p.model;

    // v2 surfaces the Responses API id on `v2.response.created` + `message.complete`.
    if (typeof p.responseId === 'string' && !state.responseId) state.responseId = p.responseId;
    if (p.type === 'message.complete') {
      state.promptTokens =
        (p.inputTokens as number | undefined) ?? (p.estimatedInputTokens as number | undefined) ?? state.promptTokens;
      state.completionTokens =
        (p.outputTokens as number | undefined) ??
        (p.estimatedOutputTokens as number | undefined) ??
        state.completionTokens;
      if (p.modelId) state.model = String(p.modelId);
      if (!state.content && (p.text ?? p.content)) {
        state.content = String(p.text ?? p.content);
      }
    }
  } catch {
    /* ignore non-JSON keepalives */
  }
}

/** Process one complete SSE line (may be empty frame separator or `data: …`). */
export function applySseLine(state: CoachStreamAccumulateState, line: string): void {
  if (!line.startsWith('data: ')) return;
  applySseDataPayload(state, line.slice(6).trim());
}

/**
 * Relay upstream SSE bytes (decoded text) to an optional writer while
 * accumulating content/usage. Keeps reading after a client drop so the turn
 * can still finish and persist server-side.
 */
export async function relayAndAccumulate(
  body: ReadableStream<Uint8Array> | null | undefined,
  options: RelayAndAccumulateOptions = {},
): Promise<CoachStreamResult> {
  const state = createCoachStreamAccumulateState();
  let firstTokenMs: number | null = null;
  let clientDropped = false;
  /** Once a write fails, stop calling writeChunk (still drain upstream). */
  let relayStopped = false;
  const t0 = Date.now();
  const lineBuf = createSseLineBuffer();
  const reader = body?.getReader();
  if (!reader) {
    return { ...state, firstTokenMs, clientDropped };
  }

  const decoder = new TextDecoder();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    const chunk = decoder.decode(value, { stream: true });
    if (firstTokenMs === null) firstTokenMs = Date.now() - t0;

    const alive = options.isClientAlive?.() ?? true;
    if (!relayStopped && alive && options.writeChunk) {
      try {
        const ok = options.writeChunk(chunk);
        if (ok === false) {
          clientDropped = true;
          relayStopped = true;
        }
      } catch {
        clientDropped = true;
        relayStopped = true;
      }
    } else if (!alive || relayStopped) {
      clientDropped = true;
    }

    for (const line of pushSseChunk(lineBuf, chunk)) {
      const had = state.responseId;
      applySseLine(state, line);
      if (!had && state.responseId) options.onResponseId?.(state.responseId);
    }
  }

  return { ...state, firstTokenMs, clientDropped };
}
