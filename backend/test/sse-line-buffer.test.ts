import { describe, it, expect } from 'vitest';

function processChunks(chunks: string[]): { lines: string[]; remaining: string } {
  let lineBuffer = '';
  const allLines: string[] = [];
  for (const chunk of chunks) {
    lineBuffer += chunk;
    const lines = lineBuffer.split('\n');
    lineBuffer = lines.pop() ?? '';
    allLines.push(...lines);
  }
  return { lines: allLines, remaining: lineBuffer };
}

describe('SSE line buffer (processChunks)', () => {
  it('handles complete lines in a single chunk', () => {
    const result = processChunks(['line1\nline2\n']);
    expect(result.lines).toEqual(['line1', 'line2']);
    expect(result.remaining).toBe('');
  });

  it('reassembles a line split across two chunks', () => {
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

  it('handles JSON split mid-object across chunks', () => {
    const result = processChunks([
      'data: {"conte',
      'nt":"he',
      'llo"}\n\n',
    ]);
    expect(result.lines).toEqual(['data: {"content":"hello"}', '']);
    expect(result.remaining).toBe('');
  });
});
