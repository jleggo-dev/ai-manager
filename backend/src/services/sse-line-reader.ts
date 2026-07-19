/**
 * Incremental SSE line reader.
 *
 * TCP/HTTP chunks can split a single SSE line across boundaries. Callers must
 * buffer incomplete trailing fragments and only process complete lines (those
 * terminated by `\n`). This module is the single implementation of that pattern
 * for the AI Admin backend (BE-02 / CROSS-02 backend half).
 */

/** Mutable buffer of the incomplete trailing fragment from the last chunk. */
export interface SseLineBuffer {
  /** Incomplete trailing fragment awaiting the next chunk (no trailing `\n`). */
  buffer: string;
}

/** Create an empty line buffer for a new stream. */
export function createSseLineBuffer(): SseLineBuffer {
  return { buffer: '' };
}

/**
 * Append a decoded text chunk and return every complete line (without the
 * trailing `\n`). Empty lines from SSE frame separators (`\n\n`) are included
 * as `''`. The incomplete trailing fragment stays in `state.buffer`.
 */
export function pushSseChunk(state: SseLineBuffer, chunk: string): string[] {
  state.buffer += chunk;
  const lines = state.buffer.split('\n');
  state.buffer = lines.pop() ?? '';
  return lines;
}
