/**
 * Client-side coach SSE parser (WEB-02).
 *
 * Extracts the incremental line-buffer + frame semantics from `sendCoachMessage` so chunk-split
 * regressions and control-frame skips are unit-testable without a live fetch stream.
 *
 * Semantics match the prior inline loop: only `choices[].delta.content` is UI text;
 * `message.complete` / `v2.response.created` are control frames (full text / id) and must not
 * be appended as deltas.
 */

/** Mutable parse state for one coach message stream. */
export interface CoachSseParseState {
  /** Incomplete trailing fragment awaiting the next chunk (no trailing `\n`). */
  buffer: string;
  responseId: string | null;
  /** True once a clean `[DONE]` data frame was seen. */
  completed: boolean;
}

export function createCoachSseParseState(): CoachSseParseState {
  return { buffer: '', responseId: null, completed: false };
}

/**
 * Apply one complete SSE `data:` payload (already stripped of the `data: ` prefix and trimmed).
 * Invokes `onDelta` for incremental content only. Returns true when `[DONE]` was seen.
 */
export function applyCoachSseData(
  state: CoachSseParseState,
  data: string,
  onDelta: (text: string) => void,
  onActivity?: (names: string[]) => void,
  onSegment?: () => void,
  onToolStart?: (names: string[]) => void,
  onStage?: (name: string) => void,
): boolean {
  if (data === '[DONE]') {
    state.completed = true;
    return true;
  }
  try {
    const p = JSON.parse(data) as Record<string, unknown>;
    if (typeof p.responseId === 'string' && !state.responseId) state.responseId = p.responseId;
    // Control frames, not content deltas: `message.complete` carries the FULL reply text
    // (the server uses it for logging) and `v2.response.created` carries the id. Appending
    // their payload here would duplicate the whole message in the UI — skip them. Only
    // incremental `choices[].delta.content` frames carry streaming text.
    if (p.type === 'message.complete' || p.type === 'v2.response.created') return false;
    /**
     * A `cadence` frame is ours, not the provider's — the server writes one when it has just run a
     * tool, so the screen can say what is happening. Handled before the delta check and returned
     * on, because it is never content and must not reach her prose.
     */
    if (p.cadence === 'tool' && Array.isArray(p.names)) {
      onActivity?.(p.names.filter((n): n is string => typeof n === 'string'));
      return false;
    }
    /**
     * Same frame family, earlier moment: she has just DECIDED to run these tools and they have not
     * executed yet. The `tool` frame above only ever arrived after the work was done, so a slow
     * tool showed bare dots for its whole run — this is the frame that lets the screen say what is
     * happening WHILE it happens. Same name vocabulary as `tool`.
     */
    if (p.cadence === 'tool_start' && Array.isArray(p.names)) {
      onToolStart?.(p.names.filter((n): n is string => typeof n === 'string'));
      return false;
    }
    /**
     * Once per turn, immediately after the stream opens and before any model work — the server
     * saying "I have your message and I am reading the file". It exists to cover the pre-first-token
     * stretch, which used to be bare dots for however long the model deliberated.
     */
    if (p.cadence === 'stage' && typeof p.name === 'string') {
      onStage?.(p.name);
      return false;
    }
    // One generation of the turn ended (a tool round, a nudge) and another may follow: the
    // current bubble is finished. Text after this belongs in a bubble of its own — never glued
    // onto the last sentence of this one.
    if (p.cadence === 'segment') {
      onSegment?.();
      return false;
    }
    const choices = p.choices as Array<{ delta?: { content?: unknown } }> | undefined;
    const delta = choices?.[0]?.delta?.content;
    if (typeof delta === 'string' && delta) onDelta(delta);
  } catch {
    /* keepalive */
  }
  return false;
}

/** Process one complete SSE line (may be empty frame separator or `data: …`). */
export function applyCoachSseLine(
  state: CoachSseParseState,
  line: string,
  onDelta: (text: string) => void,
  onActivity?: (names: string[]) => void,
  onSegment?: () => void,
  onToolStart?: (names: string[]) => void,
  onStage?: (name: string) => void,
): boolean {
  if (!line.startsWith('data: ')) return false;
  return applyCoachSseData(state, line.slice(6).trim(), onDelta, onActivity, onSegment, onToolStart, onStage);
}

/**
 * Append a decoded text chunk and process every complete line. Incomplete trailing fragments
 * stay in `state.buffer`. Returns true once `[DONE]` has been seen (caller may stop reading).
 */
export function pushCoachSseChunk(
  state: CoachSseParseState,
  chunk: string,
  onDelta: (text: string) => void,
  onActivity?: (names: string[]) => void,
  onSegment?: () => void,
  onToolStart?: (names: string[]) => void,
  onStage?: (name: string) => void,
): boolean {
  state.buffer += chunk;
  const lines = state.buffer.split('\n');
  state.buffer = lines.pop() ?? '';
  for (const line of lines) {
    if (applyCoachSseLine(state, line, onDelta, onActivity, onSegment, onToolStart, onStage)) return true;
  }
  return state.completed;
}
