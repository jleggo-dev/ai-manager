import { describe, it, expect } from 'vitest';
import { createSseLineBuffer, pushSseChunk } from './sse-line-reader.ts';

/** Characterization helper — same chunk-split contract as BE-02 / coach-stream. */
function processChunks(chunks: string[]): { lines: string[]; remaining: string } {
  const state = createSseLineBuffer();
  const allLines: string[] = [];
  for (const chunk of chunks) {
    allLines.push(...pushSseChunk(state, chunk));
  }
  return { lines: allLines, remaining: state.buffer };
}

describe('@ai-admin/core SSE line buffer (sse-line-reader)', () => {
  it('handles complete lines in a single chunk', () => {
    const result = processChunks(['line1\nline2\n']);
    expect(result.lines).toEqual(['line1', 'line2']);
    expect(result.remaining).toBe('');
  });

  it('reassembles a line split across two chunks (R1 regression)', () => {
    const result = processChunks(['hel', 'lo\n']);
    expect(result.lines).toEqual(['hello']);
    expect(result.remaining).toBe('');
  });

  it('handles multiple lines in one chunk', () => {
    const result = processChunks(['a\nb\nc\n']);
    expect(result.lines).toEqual(['a', 'b', 'c']);
    expect(result.remaining).toBe('');
  });

  it('keeps partial line at end in remaining buffer', () => {
    const result = processChunks(['full\npart']);
    expect(result.lines).toEqual(['full']);
    expect(result.remaining).toBe('part');
  });

  it('does not produce ghost lines from empty chunks', () => {
    const result = processChunks(['', '', 'hello\n', '']);
    expect(result.lines).toEqual(['hello']);
    expect(result.remaining).toBe('');
  });

  it('properly splits SSE data: {"content":"hello"}\\n\\n', () => {
    const result = processChunks(['data: {"content":"hello"}\n\n']);
    expect(result.lines).toEqual(['data: {"content":"hello"}', '']);
    expect(result.remaining).toBe('');
  });

  it('properly detects data: [DONE]\\n\\n', () => {
    const result = processChunks(['data: [DONE]\n\n']);
    expect(result.lines).toEqual(['data: [DONE]', '']);
    expect(result.remaining).toBe('');
  });

  it('handles JSON split mid-object across chunks (R1 regression)', () => {
    const result = processChunks(['data: {"conte', 'nt":"he', 'llo"}\n\n']);
    expect(result.lines).toEqual(['data: {"content":"hello"}', '']);
    expect(result.remaining).toBe('');
  });

  it('reassembles multi-event payload split on arbitrary boundaries', () => {
    const payload = 'data: {"a":1}\n\ndata: {"b":2}\n\ndata: [DONE]\n\n';
    const chunks: string[] = [];
    for (let i = 0; i < payload.length; i += 7) {
      chunks.push(payload.slice(i, i + 7));
    }
    const result = processChunks(chunks);
    expect(result.lines).toEqual(['data: {"a":1}', '', 'data: {"b":2}', '', 'data: [DONE]', '']);
    expect(result.remaining).toBe('');
  });
});
