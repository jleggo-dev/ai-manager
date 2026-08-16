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
): boolean {
  if (!line.startsWith('data: ')) return false;
  return applyCoachSseData(state, line.slice(6).trim(), onDelta, onActivity);
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
): boolean {
  state.buffer += chunk;
  const lines = state.buffer.split('\n');
  state.buffer = lines.pop() ?? '';
  for (const line of lines) {
    if (applyCoachSseLine(state, line, onDelta, onActivity)) return true;
  }
  return state.completed;
}
