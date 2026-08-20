/**
 * Coach SSE relay + accumulate (API-03 / CROSS-02 cadence half).
 *
 * Reads an upstream AI Admin chat stream, relays decoded text chunks to the
 * client while connected, and accumulates assistant content + usage across
 * both upstream frame shapes (OpenAI-style deltas and v2 `message.complete`).
 * Line buffering uses `@ai-admin/core`'s `createSseLineBuffer` (same contract
 * as backend BE-02) so TCP chunk-splits cannot drop mid-line JSON.
 */

import { createSseLineBuffer, pushSseChunk, extractFunctionCallsFromOutput } from '@ai-admin/core';

/** Accumulated bookkeeping from one coach turn stream. */
export interface CoachStreamResult {
  content: string;
  promptTokens: number | null;
  completionTokens: number | null;
  model: string | null;
  responseId: string | null;
  /** The LAST response id of the turn — the continuation's after a tool loop. Thread mode (#250)
   *  anchors the next turn on this, so it must be the id whose server-side thread is complete. */
  currentResponseId: string | null;
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
   * Fired as soon as a stream names an upstream response — and again per ROUND in a tool loop,
   * because Stop needs the id of the response generating right now, mid-stream; by the time the
   * relay returns there is nothing left to stop.
   */
  onResponseId?: (responseId: string) => void;
  /**
   * Tool-loop mode: forward LINE-wise and hold back upstream `data: [DONE]` terminals. The web
   * client resolves the whole turn on the FIRST [DONE] it sees, so when continuations follow,
   * only the loop may say done — it writes the single real terminal itself.
   */
  suppressDone?: boolean;
  /** Continue accumulating into an existing state (a tool loop's later rounds). */
  state?: CoachStreamAccumulateState;
}

/** Mutable accumulate state — shared by the stream loop and per-line parser. */
export interface CoachStreamAccumulateState {
  content: string;
  promptTokens: number | null;
  completionTokens: number | null;
  model: string | null;
  responseId: string | null;
  /** The id of the response generating RIGHT NOW — updated every round of a tool loop, where
   *  `responseId` keeps first-seen semantics for the turn's logging. Stop targets this one. */
  currentResponseId: string | null;
  /** function_call items read off completed responses (the tool loop's inbox). The reply's text
   *  rides DELTAS — message.complete arrives with empty text (probed 2026-08-14) — but its
   *  `output` array is where completed calls appear with their full arguments. */
  functionCalls: Array<{ toolCallId: string; name: string; arguments?: string }>;
}

export function createCoachStreamAccumulateState(): CoachStreamAccumulateState {
  return {
    content: '',
    promptTokens: null,
    completionTokens: null,
    model: null,
    responseId: null,
    currentResponseId: null,
    functionCalls: [],
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
    if (typeof p.responseId === 'string') {
      if (!state.responseId) state.responseId = p.responseId;
      state.currentResponseId = p.responseId;
    }
    if (p.type === 'message.complete') {
      // Completed function calls live in the response's output array (arguments fully
      // assembled) — the tool loop's one reliable pickup point.
      for (const call of extractFunctionCallsFromOutput(p.output)) {
        if (!state.functionCalls.some((c) => c.toolCallId === call.toolCallId)) state.functionCalls.push(call);
      }
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
  const state = options.state ?? createCoachStreamAccumulateState();
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
    const writeOut = (text: string): void => {
      if (relayStopped || !alive || !options.writeChunk) {
        if (!alive || relayStopped) clientDropped = true;
        return;
      }
      try {
        const ok = options.writeChunk(text);
        if (ok === false) {
          clientDropped = true;
          relayStopped = true;
        }
      } catch {
        clientDropped = true;
        relayStopped = true;
      }
    };

    // Verbatim raw-chunk relay in the ordinary single-stream case; line-wise with the upstream
    // terminals held back when a tool loop owns the turn's ending.
    if (!options.suppressDone) writeOut(chunk);

    for (const line of pushSseChunk(lineBuf, chunk)) {
      if (options.suppressDone && line.trim() !== 'data: [DONE]') writeOut(`${line}\n`);
      const had = state.currentResponseId;
      applySseLine(state, line);
      if (state.currentResponseId && state.currentResponseId !== had) options.onResponseId?.(state.currentResponseId);
    }
  }

  return { ...state, firstTokenMs, clientDropped };
}
