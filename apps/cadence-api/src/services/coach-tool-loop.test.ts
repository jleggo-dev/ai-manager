import { describe, expect, it, vi } from 'vitest';
import { MAX_COACH_TOOL_ROUNDS, relayCoachTurnWithTools } from './coach-tool-loop.ts';

/**
 * The tool loop, against fabricated upstream streams. The live probe (#189-#191) proved the
 * upstream halves; these prove the RELAY's contract — the pieces a device test can't isolate:
 * exactly one [DONE] reaches the client, content accumulates across continuations, unknown tool
 * names are left alone, the round cap holds, and a failed fulfillment still ends the turn
 * cleanly. Stream shapes mirror the probe's captured stream (message.complete with an `output`
 * array carrying completed function_call items; the reply's text riding deltas).
 */

const enc = new TextEncoder();
const stream = (lines: string[]): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(ctrl) {
      ctrl.enqueue(enc.encode(lines.map((l) => `${l}\n`).join('')));
      ctrl.close();
    },
  });

const delta = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}`;
const complete = (responseId: string, calls: Array<{ id: string; name: string }> = []) =>
  `data: ${JSON.stringify({
    type: 'message.complete',
    text: '',
    responseId,
    output: calls.map((c) => ({
      type: 'function_call',
      call_id: c.id,
      name: c.name,
      arguments: '{}',
      status: 'completed',
    })),
  })}`;
const DONE = 'data: [DONE]';

function collectWrites() {
  const writes: string[] = [];
  return { writes, writeChunk: (t: string) => void writes.push(t) };
}

describe('relayCoachTurnWithTools', () => {
  it('plain turn: relays deltas, suppresses upstream terminals, writes exactly one [DONE]', async () => {
    const { writes, writeChunk } = collectWrites();
    const result = await relayCoachTurnWithTools(
      stream([delta('Hello'), delta(' there'), DONE, complete('r1'), DONE]),
      { toolNames: new Set(['get_weight']), execute: vi.fn(), submit: vi.fn() },
      { writeChunk },
    );
    expect(result.content).toBe('Hello there');
    expect(result.toolRounds).toBe(0);
    const dones = writes.filter((w) => w.includes('[DONE]'));
    expect(dones).toHaveLength(1);
    expect(writes[writes.length - 1]).toContain('[DONE]');
  });

  it('one tool round: fulfills the call, submits against the CURRENT response id, stitches the continuation', async () => {
    const { writes, writeChunk } = collectWrites();
    const execute = vi.fn(async (calls: Array<{ toolCallId: string; name: string }>) =>
      calls.map((c) => ({ toolCallId: c.toolCallId, output: 'Weight: 88.5 kg' })),
    );
    const submit = vi.fn(async () => stream([delta('You are at 88.5 kg.'), complete('r2'), DONE]));
    const result = await relayCoachTurnWithTools(
      stream([delta('Let me check your file… '), complete('r1', [{ id: 't1', name: 'get_weight' }]), DONE]),
      { toolNames: new Set(['get_weight']), execute, submit },
      { writeChunk },
    );
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute.mock.calls[0]![0]).toEqual([{ toolCallId: 't1', name: 'get_weight', arguments: '{}' }]);
    expect(submit).toHaveBeenCalledWith('r1', [{ toolCallId: 't1', output: 'Weight: 88.5 kg' }]);
    expect(result.content).toBe('Let me check your file… You are at 88.5 kg.');
    expect(result.toolRounds).toBe(1);
    expect(writes.filter((w) => w.includes('[DONE]'))).toHaveLength(1);
  });

  it('a call whose name is not ours is left alone', async () => {
    const execute = vi.fn();
    const submit = vi.fn();
    const result = await relayCoachTurnWithTools(
      stream([delta('Hi'), complete('r1', [{ id: 't9', name: 'some_profile_tool_job' }]), DONE]),
      { toolNames: new Set(['get_weight']), execute, submit },
      {},
    );
    expect(execute).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
    expect(result.content).toBe('Hi');
  });

  it('caps the rounds: a model that never stops calling gets its last stream as the answer', async () => {
    let round = 0;
    const execute = vi.fn(async (calls: Array<{ toolCallId: string }>) =>
      calls.map((c) => ({ toolCallId: c.toolCallId, output: 'x' })),
    );
    const submit = vi.fn(async (_responseId: string) => {
      round++;
      return stream([
        delta(`round${round} `),
        complete(`r${round + 1}`, [{ id: `t${round + 1}`, name: 'get_weight' }]),
        DONE,
      ]);
    });
    const result = await relayCoachTurnWithTools(
      stream([complete('r1', [{ id: 't1', name: 'get_weight' }]), DONE]),
      { toolNames: new Set(['get_weight']), execute, submit },
      {},
    );
    expect(result.toolRounds).toBe(MAX_COACH_TOOL_ROUNDS);
    expect(submit).toHaveBeenCalledTimes(MAX_COACH_TOOL_ROUNDS);
    // Each continuation was threaded on ITS round's response id, not the first one.
    expect(submit.mock.calls.map((c) => c[0])).toEqual(['r1', 'r2', 'r3']);
  });

  it('a failed fulfillment ends the turn with what streamed — and still says done', async () => {
    const { writes, writeChunk } = collectWrites();
    const execute = vi.fn(async () => {
      throw new Error('registry down');
    });
    const submit = vi.fn();
    const result = await relayCoachTurnWithTools(
      stream([delta('One sec… '), complete('r1', [{ id: 't1', name: 'get_weight' }]), DONE]),
      { toolNames: new Set(['get_weight']), execute, submit },
      { writeChunk },
    );
    expect(result.content).toBe('One sec… ');
    expect(submit).not.toHaveBeenCalled();
    expect(writes.filter((w) => w.includes('[DONE]'))).toHaveLength(1);
  });

  it('reports the CURRENT response id per round to the stop hook', async () => {
    const ids: string[] = [];
    const execute = vi.fn(async (calls: Array<{ toolCallId: string }>) =>
      calls.map((c) => ({ toolCallId: c.toolCallId, output: 'x' })),
    );
    const submit = vi.fn(async () => stream([delta('done'), complete('r2'), DONE]));
    await relayCoachTurnWithTools(
      stream([complete('r1', [{ id: 't1', name: 'get_weight' }]), DONE]),
      { toolNames: new Set(['get_weight']), execute, submit },
      { onResponseId: (id) => void ids.push(id) },
    );
    expect(ids).toEqual(['r1', 'r2']);
  });
});
