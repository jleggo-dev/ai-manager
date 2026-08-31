import { describe, it, expect } from 'vitest';
import { applyCoachSseData, applyCoachSseLine, createCoachSseParseState, pushCoachSseChunk } from './coach-sse.ts';

function collectDeltas(chunks: string[]): {
  deltas: string[];
  completed: boolean;
  responseId: string | null;
  remaining: string;
} {
  const state = createCoachSseParseState();
  const deltas: string[] = [];
  for (const chunk of chunks) {
    pushCoachSseChunk(state, chunk, (t) => deltas.push(t));
  }
  return {
    deltas,
    completed: state.completed,
    responseId: state.responseId,
    remaining: state.buffer,
  };
}

describe('coach-sse parser', () => {
  it('emits incremental delta content from a single chunk', () => {
    const result = collectDeltas(['data: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: [DONE]\n\n']);
    expect(result.deltas).toEqual(['Hi']);
    expect(result.completed).toBe(true);
    expect(result.remaining).toBe('');
  });

  it('reassembles a data line split across chunks (R1 regression)', () => {
    const result = collectDeltas(['data: {"choices":[{"del', 'ta":{"content":"hel', 'lo"}}]}\n', 'data: [DONE]\n']);
    expect(result.deltas).toEqual(['hello']);
    expect(result.completed).toBe(true);
  });

  it('skips message.complete so full text is not duplicated as a delta', () => {
    const result = collectDeltas([
      'data: {"choices":[{"delta":{"content":"partial"}}]}\n',
      'data: {"type":"message.complete","text":"partial full reply"}\n',
      'data: [DONE]\n',
    ]);
    expect(result.deltas).toEqual(['partial']);
    expect(result.completed).toBe(true);
  });

  it('skips v2.response.created and captures responseId once', () => {
    const result = collectDeltas([
      'data: {"type":"v2.response.created","responseId":"resp_1"}\n',
      'data: {"choices":[{"delta":{"content":"ok"}}],"responseId":"resp_1"}\n',
      'data: [DONE]\n',
    ]);
    expect(result.deltas).toEqual(['ok']);
    expect(result.responseId).toBe('resp_1');
    expect(result.completed).toBe(true);
  });

  it('ignores non-JSON keepalives without throwing', () => {
    const state = createCoachSseParseState();
    const deltas: string[] = [];
    expect(applyCoachSseData(state, ': keepalive', (t) => deltas.push(t))).toBe(false);
    expect(deltas).toEqual([]);
    expect(state.completed).toBe(false);
  });

  it('applyCoachSseLine ignores non-data lines', () => {
    const state = createCoachSseParseState();
    const deltas: string[] = [];
    expect(applyCoachSseLine(state, 'event: ping', (t) => deltas.push(t))).toBe(false);
    expect(applyCoachSseLine(state, '', (t) => deltas.push(t))).toBe(false);
    expect(deltas).toEqual([]);
  });

  it('leaves incomplete trailing fragment in the buffer when stream pauses', () => {
    const result = collectDeltas(['data: {"choices":[{"delta":{"content":"a"}}]}\ndata: {"cho']);
    expect(result.deltas).toEqual(['a']);
    expect(result.completed).toBe(false);
    expect(result.remaining).toBe('data: {"cho');
  });

  it('returns completed:false semantics when [DONE] never arrives', () => {
    const result = collectDeltas(['data: {"choices":[{"delta":{"content":"cut"}}]}\n']);
    expect(result.deltas).toEqual(['cut']);
    expect(result.completed).toBe(false);
  });

  /** The seam between two generations of one turn: never content, always the onSegment signal. */
  it('routes a segment frame to onSegment and never into the prose', () => {
    const state = createCoachSseParseState();
    const deltas: string[] = [];
    let segments = 0;
    const push = (chunk: string) =>
      pushCoachSseChunk(
        state,
        chunk,
        (t) => deltas.push(t),
        undefined,
        () => segments++,
      );
    push('data: {"choices":[{"delta":{"content":"First answer."}}]}\n');
    push('data: {"cadence":"segment"}\n\n');
    push('data: {"choices":[{"delta":{"content":"Second answer."}}]}\n');
    expect(deltas).toEqual(['First answer.', 'Second answer.']);
    expect(segments).toBe(1);
  });
});
