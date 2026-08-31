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
  /**
   * The turn's text split at generation boundaries — one entry per model response that produced
   * prose (a round before a tool call, the answer after it, a nudge's correction). `content` is
   * the raw glue of all of them and exists for compatibility; anything user-facing should join
   * these with a blank line instead. Empty when the turn never crossed a boundary — the caller
   * falls back to `content`.
   *
   * Why this exists: one accumulator across rounds concatenated four drafts of an answer into a
   * single paragraph ("…Tuesday's bike instead?Good catch — that solves two problems…",
   * 2026-08-31) and made a second cadence-picks block reachable in one turn. The transcript keeps
   * the structure; rendering flattens it, never the other way around.
   */
  segments: string[];
  promptTokens: number | null;
  completionTokens: number | null;
  /**
   * How much of `promptTokens` the provider served from its prompt cache, summed across the turn's
   * rounds the same way the others are.
   *
   * Here to answer a question nobody could answer before: a coach turn carries a byte-identical
   * ~9,600-token prefix (persona + tool definitions) on every single message, and the provider has
   * always reported `input_tokens_details.cached_tokens` — the field is in `V2Usage` — but nothing
   * read it. So "22,869 prompt tokens/turn" could never be told apart from what was actually
   * billed, and no cost decision had an honest baseline.
   *
   * `null` = the provider said nothing. `0` = it said nothing was cached. Keeping those apart is
   * the point: a zero proves the reporting works and the prefix is simply not being reused, which
   * is a different problem from silence and has a different fix.
   */
  cachedPromptTokens: number | null;
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
  /** Completed generation texts — see `CoachStreamResult.segments`. */
  segments: string[];
  /** Where in `content` the CURRENT (unfinished) segment begins. Advanced by `endCoachSegment`. */
  segmentMark: number;
  promptTokens: number | null;
  completionTokens: number | null;
  /** Provider-reported cache hits on the prompt, summed across rounds. See `CoachStreamResult`. */
  cachedPromptTokens: number | null;
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
    segments: [],
    segmentMark: 0,
    promptTokens: null,
    completionTokens: null,
    cachedPromptTokens: null,
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
/**
 * What one response has ALREADY contributed to the turn's totals.
 *
 * `null` means "this response has never reported that field", which is deliberately different from
 * `0`: a first report of zero must still move `promptTokens` off `null` (a zero proves the provider
 * is reporting and nothing was cached — see `cachedPromptTokens`), while a REPEAT of zero must not.
 */
interface CountedUsage {
  prompt: number | null;
  cached: number | null;
  completion: number | null;
}

/**
 * Kept in a side table rather than on the state, so the object `relayAndAccumulate` returns keeps
 * exactly the shape its callers destructure and its exhaustive `toEqual` test asserts. This is
 * bookkeeping ABOUT the accumulation, not part of the turn's result. Weak so it dies with the state.
 */
const counted = new WeakMap<CoachStreamAccumulateState, Map<string, CountedUsage>>();

/**
 * Add a usage figure, counting each RESPONSE at most once — the fix for totals that were provably
 * impossible (2026-08-29).
 *
 * Captured off the wire, a single turn looked like this:
 *
 *     message.complete{inputTokens:24081, cachedInputTokens:15255} resp=4fc60fcb82c1
 *     message.complete{inputTokens:0,     cachedInputTokens:15255} resp=4fc60fcb82c1
 *
 * The SAME response reported twice — `sse-transform` emits `message.complete` for both
 * `response.completed` and `response.done` — and every frame was being summed. The trailing frame
 * carries `input_tokens: 0`, so the prompt side added nothing, while the cached side added a second
 * 15,255. Every multi-run measurement showed a byte-identical 30,510 cached against 24,113 prompt:
 * 127% of a prompt cached, which cannot happen. A duplicate that repeats input AND output (also
 * observed) double-counts the prompt instead.
 *
 * So: per response, remember what each field has contributed and add only the INCREASE. A duplicate
 * reporting 0 cannot lower a total; a duplicate repeating a figure cannot inflate one; a later,
 * larger figure for the same response still lands.
 *
 * Frames with no `responseId` keep the old straight-sum behaviour. That is what MP30 fixed and its
 * tests still pin: separate tool-loop ROUNDS are separate responses and must still add up.
 */
function contribute(
  state: CoachStreamAccumulateState,
  responseId: string | null,
  field: keyof CountedUsage,
  value: number,
): void {
  const apply = (delta: number): void => {
    if (field === 'prompt') state.promptTokens = (state.promptTokens ?? 0) + delta;
    else if (field === 'completion') state.completionTokens = (state.completionTokens ?? 0) + delta;
    else state.cachedPromptTokens = (state.cachedPromptTokens ?? 0) + delta;
  };

  if (!responseId) {
    apply(value);
    return;
  }

  let ledger = counted.get(state);
  if (!ledger) {
    ledger = new Map();
    counted.set(state, ledger);
  }
  const entry = ledger.get(responseId) ?? { prompt: null, cached: null, completion: null };
  const seen = entry[field];
  if (seen === null) apply(value);
  else if (value > seen) apply(value - seen);
  else return;
  entry[field] = value;
  ledger.set(responseId, entry);
}

/**
 * Close the segment being accumulated: everything `content` gained since the last boundary
 * becomes one entry in `state.segments`, and (when a writer is given) a `{"cadence":"segment"}`
 * frame tells the client to close its bubble too. A boundary with no new text is a no-op — the
 * client must never be told to open a bubble nothing will fill.
 *
 * Called by the tool loop wherever one generation ends and another may begin: after a round that
 * will continue into a tool exchange, and before each nudge. The final flush at turn end passes
 * no writer — `[DONE]` already closes the client's last bubble.
 */
export function endCoachSegment(
  state: CoachStreamAccumulateState,
  writeChunk?: (chunk: string) => boolean | void,
): void {
  const text = state.content.slice(state.segmentMark).trim();
  state.segmentMark = state.content.length;
  if (!text) return;
  state.segments.push(text);
  if (!writeChunk) return;
  try {
    writeChunk('data: {"cadence":"segment"}\n\n');
  } catch {
    /* client gone; the segment record still stands */
  }
}

/**
 * Everything the assistant has said this turn so far — the closed segments plus whatever the
 * current generation has streamed since the last boundary, joined the same way the persisted
 * reply is. Carried into every continuation as an assistant message (M0, 2026-08-31): a
 * continuation that has never seen its own words re-answers from scratch, and that fresh
 * generation was the root of the four-drafts-in-one-bubble replies.
 */
export function coachTextSoFar(state: CoachStreamAccumulateState): string {
  const tail = state.content.slice(state.segmentMark).trim();
  return [...state.segments, ...(tail ? [tail] : [])].join('\n\n');
}

export function applySseDataPayload(state: CoachStreamAccumulateState, data: string): void {
  if (data === '[DONE]') return;
  try {
    const p = JSON.parse(data) as Record<string, unknown>;
    const choices = p.choices as Array<{ delta?: { content?: unknown } }> | undefined;
    const delta = choices?.[0]?.delta?.content;
    if (typeof delta === 'string') state.content += delta;

    // Read from the FRAME, not from `state.currentResponseId`, which is only assigned further down
    // — and which would wrongly attribute a frame to the previous response until it caught up.
    const frameResponseId = typeof p.responseId === 'string' ? p.responseId : null;

    // OpenAI-style usage/model arrive on the final chunk (Devs.ai completion stream).
    const usage = p.usage as { prompt_tokens?: number; completion_tokens?: number } | undefined;
    if (usage) {
      /**
       * SUM across rounds, never overwrite (MP30). `state` is the SAME object threaded through
       * every round of the tool loop (`coach-tool-loop.ts` passes `{ ...options, state }` into
       * each `relayAndAccumulate` call), and each round is its own full, separately-billed model
       * call — round two's prompt is round one's plus the tool exchange, round three's is bigger
       * again. The turn's real cost is the SUM of every round's prompt tokens, not any one round's.
       *
       * This used to be `usage.prompt_tokens ?? state.promptTokens` — a plain overwrite. A
       * continuation reports `prompt_tokens: 0` (not a missing field — an explicit zero; see
       * `coach-tools.ts`'s `recordToolCalls` comment), and `0 ?? x` is `0`, not `x`, because `??`
       * only falls through on `null`/`undefined`. So the LAST round's zero silently replaced the
       * running total: a turn that ran three tool rounds could report FEWER prompt tokens than one
       * that ran none — the most expensive turns reporting the least, straight into AI Admin's
       * cost diagnostics (`recordCoachReply`'s `usage.prompt_tokens`).
       *
       * Only add when a real number arrived — an absent field must still leave `state.promptTokens`
       * untouched (still `null` if nothing has landed yet, still the prior total otherwise), same
       * as the old `?? state.promptTokens` fallback did for a genuinely missing field. Only the
       * EXPLICIT-zero case changes: it now adds zero (a no-op on the total) instead of replacing it.
       * `completionTokens` gets the identical fix for the identical reason — it is just as much a
       * separately-billed per-round number as the prompt side.
       */
      if (typeof usage.prompt_tokens === 'number') {
        contribute(state, frameResponseId, 'prompt', usage.prompt_tokens);
      }
      if (typeof usage.completion_tokens === 'number') {
        contribute(state, frameResponseId, 'completion', usage.completion_tokens);
      }
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
      // Same SUM-not-overwrite fix as the OpenAI-shaped branch above (MP30), for v2's own usage
      // fields. `typeof … === 'number'` also guards against a malformed/non-numeric field, which
      // the old `as number | undefined` cast trusted blindly — consistent with the `typeof delta
      // === 'string'` check this file already uses a few lines up for the same untrusted JSON.
      const inputTokens = (p.inputTokens as number | undefined) ?? (p.estimatedInputTokens as number | undefined);
      if (typeof inputTokens === 'number') contribute(state, frameResponseId, 'prompt', inputTokens);
      // Counted per RESPONSE, not per frame (see `contribute`): every ROUND is its own billed call
      // and a cache hit on round three is as real as one on round one, but the same response
      // reported twice is one call, not two.
      const cachedIn = p.cachedInputTokens as number | undefined;
      if (typeof cachedIn === 'number') contribute(state, frameResponseId, 'cached', cachedIn);
      const outputTokens = (p.outputTokens as number | undefined) ?? (p.estimatedOutputTokens as number | undefined);
      if (typeof outputTokens === 'number') contribute(state, frameResponseId, 'completion', outputTokens);
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
