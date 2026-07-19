/**
 * Incremental SSE line reader (CROSS-02 / API-03 cadence half).
 *
 * TCP/HTTP chunks can split a single SSE line across boundaries. Callers must
 * buffer incomplete trailing fragments and only process complete lines (those
 * terminated by `\n`). API matches the AI Admin backend's BE-02
 * `createSseLineBuffer` / `pushSseChunk` so both products share one contract.
 *
 * Lives here (not `packages/client`) because Cadence already depends on
 * `@ai-admin/core` for the in-process seam, and `packages/client`'s
 * `parseSseText` is whole-string, not incremental.
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
