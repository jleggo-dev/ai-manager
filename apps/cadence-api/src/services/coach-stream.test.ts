/**
 * API-03 — characterization tests for coach SSE relay/accumulate.
 * Covers both upstream frame shapes and the R1 TCP chunk-split regression.
 */
import { describe, it, expect, vi } from 'vitest';
import { applySseDataPayload, createCoachStreamAccumulateState, relayAndAccumulate } from './coach-stream.ts';

/** Build a ReadableStream from UTF-8 text chunks (simulates TCP framing). */
function streamFromChunks(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[i++]));
    },
  });
}

describe('applySseDataPayload — OpenAI-style delta frames', () => {
  it('accumulates delta content and final usage/model', () => {
    const state = createCoachStreamAccumulateState();
    applySseDataPayload(state, JSON.stringify({ choices: [{ delta: { content: 'Hello' } }] }));
    applySseDataPayload(state, JSON.stringify({ choices: [{ delta: { content: ' world' } }] }));
    applySseDataPayload(
      state,
      JSON.stringify({
        model: 'gpt-test',
        usage: { prompt_tokens: 10, completion_tokens: 4 },
        choices: [{ delta: {} }],
      }),
    );
    applySseDataPayload(state, '[DONE]');

    expect(state.content).toBe('Hello world');
    expect(state.model).toBe('gpt-test');
    expect(state.promptTokens).toBe(10);
    expect(state.completionTokens).toBe(4);
  });
});

describe('applySseDataPayload — v2 message.complete frames', () => {
  it('takes text + tokens from message.complete when no deltas arrived', () => {
    const state = createCoachStreamAccumulateState();
    applySseDataPayload(state, JSON.stringify({ type: 'v2.response.created', responseId: 'resp_abc' }));
    applySseDataPayload(
      state,
      JSON.stringify({
        type: 'message.complete',
        text: 'Full reply from v2',
        inputTokens: 20,
        outputTokens: 8,
        modelId: 'gemini-test',
      }),
    );

    expect(state.content).toBe('Full reply from v2');
    expect(state.responseId).toBe('resp_abc');
    expect(state.promptTokens).toBe(20);
    expect(state.completionTokens).toBe(8);
    expect(state.model).toBe('gemini-test');
  });

  it('does not overwrite content already built from deltas', () => {
    const state = createCoachStreamAccumulateState();
    applySseDataPayload(state, JSON.stringify({ choices: [{ delta: { content: 'streamed' } }] }));
    applySseDataPayload(
      state,
      JSON.stringify({
        type: 'message.complete',
        text: 'should not replace',
        outputTokens: 1,
      }),
    );
    expect(state.content).toBe('streamed');
    expect(state.completionTokens).toBe(1);
  });
});

describe('relayAndAccumulate', () => {
  it('reassembles OpenAI frames split across TCP chunk boundaries (R1)', async () => {
    const payload =
      'data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"!"}}],"model":"m1","usage":{"prompt_tokens":3,"completion_tokens":2}}\n\n' +
      'data: [DONE]\n\n';
    const chunks: string[] = [];
    for (let i = 0; i < payload.length; i += 11) {
      chunks.push(payload.slice(i, i + 11));
    }

    const written: string[] = [];
    const result = await relayAndAccumulate(streamFromChunks(chunks), {
      writeChunk: (c) => {
        written.push(c);
      },
    });

    expect(result.content).toBe('Hi!');
    expect(result.model).toBe('m1');
    expect(result.promptTokens).toBe(3);
    expect(result.completionTokens).toBe(2);
    expect(result.clientDropped).toBe(false);
    expect(written.join('')).toBe(payload);
  });

  it('accumulates message.complete when chunks split mid-JSON', async () => {
    const payload = 'data: {"type":"message.complete","text":"ok","inputTokens":1,"outputTokens":1,"modelId":"v2"}\n\n';
    const chunks = [payload.slice(0, 20), payload.slice(20)];

    const result = await relayAndAccumulate(streamFromChunks(chunks));
    expect(result.content).toBe('ok');
    expect(result.model).toBe('v2');
    expect(result.promptTokens).toBe(1);
    expect(result.completionTokens).toBe(1);
  });

  it('keeps draining after writeChunk fails (client drop)', async () => {
    const payload =
      'data: {"choices":[{"delta":{"content":"a"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"b"}}]}\n\n' +
      'data: [DONE]\n\n';

    let writes = 0;
    const result = await relayAndAccumulate(streamFromChunks([payload]), {
      writeChunk: () => {
        writes += 1;
        if (writes === 1) throw new Error('ECONNRESET');
      },
    });

    expect(result.clientDropped).toBe(true);
    expect(result.content).toBe('ab');
  });

  it('skips writes when isClientAlive is false but still accumulates', async () => {
    const payload = 'data: {"choices":[{"delta":{"content":"x"}}]}\n\n';
    const writeChunk = vi.fn();
    const result = await relayAndAccumulate(streamFromChunks([payload]), {
      isClientAlive: () => false,
      writeChunk,
    });

    expect(writeChunk).not.toHaveBeenCalled();
    expect(result.clientDropped).toBe(true);
    expect(result.content).toBe('x');
  });

  it('returns empty accumulate when body is null', async () => {
    const result = await relayAndAccumulate(null);
    expect(result).toEqual({
      content: '',
      promptTokens: null,
      completionTokens: null,
      model: null,
      responseId: null,
      firstTokenMs: null,
      clientDropped: false,
    });
  });

  /**
   * The Stop button's whole dependency. The id has to arrive WHILE the turn is generating — after
   * relayAndAccumulate returns there is nothing left to cancel — and it must arrive once, not on
   * every subsequent frame that repeats it.
   */
  it('announces the upstream response id mid-stream, exactly once', async () => {
    const payload =
      'data: {"type":"v2.response.created","responseId":"resp_1"}\n\n' +
      'data: {"choices":[{"delta":{"content":"Right — so "}}]}\n\n' +
      'data: {"type":"message.complete","responseId":"resp_1","text":"Right — so you have been"}\n\n';

    const seen: Array<{ id: string; contentSoFar: string }> = [];
    const state = { content: '' };
    const result = await relayAndAccumulate(streamFromChunks([payload.slice(0, 60), payload.slice(60)]), {
      writeChunk: (c) => {
        state.content += c;
      },
      onResponseId: (id) => seen.push({ id, contentSoFar: state.content }),
    });

    expect(seen.map((s) => s.id)).toEqual(['resp_1']);
    // Announced off the FIRST frame — before she had said anything, which is when Stop needs it.
    expect(seen[0]?.contentSoFar).not.toContain('Right — so');
    expect(result.responseId).toBe('resp_1');
  });

  it('says nothing when the stream never names a response', async () => {
    const onResponseId = vi.fn();
    await relayAndAccumulate(streamFromChunks(['data: {"choices":[{"delta":{"content":"x"}}]}\n\n']), {
      onResponseId,
    });
    expect(onResponseId).not.toHaveBeenCalled();
  });
});
