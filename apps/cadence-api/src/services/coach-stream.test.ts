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
      segments: [],
      segmentMark: 0,
      promptTokens: null,
      cachedPromptTokens: null,
      completionTokens: null,
      model: null,
      responseId: null,
      currentResponseId: null,
      functionCalls: [],
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

  /**
   * MP30 — `state.promptTokens = usage.prompt_tokens ?? state.promptTokens` was a plain overwrite,
   * and `state` is the SAME object the tool loop threads through every round
   * (`coach-tool-loop.ts`'s `relayAndAccumulate(body, { ...options, state, suppressDone: true })`).
   * A continuation reports `prompt_tokens: 0` — an explicit zero, not a missing field — and
   * `0 ?? x` is `0`, so the last round's zero silently erased the total instead of adding to it.
   */
  describe('prompt/completion tokens sum across tool-loop rounds (MP30)', () => {
    it("a later round reporting 0 does not erase an earlier round's count", async () => {
      const state = createCoachStreamAccumulateState();
      await relayAndAccumulate(
        streamFromChunks([
          'data: {"usage":{"prompt_tokens":18979,"completion_tokens":40},"choices":[{"delta":{}}]}\n\n',
        ]),
        { state, suppressDone: true },
      );
      expect(state.promptTokens).toBe(18979);

      // Round two: a tool-loop continuation, sharing the SAME state — exactly as coach-tool-loop.ts
      // calls it. Upstream reports 0, the documented continuation shape (coach-tools.ts).
      const result = await relayAndAccumulate(
        streamFromChunks(['data: {"usage":{"prompt_tokens":0,"completion_tokens":12},"choices":[{"delta":{}}]}\n\n']),
        { state, suppressDone: true },
      );

      expect(result.promptTokens).toBe(18979);
      expect(result.completionTokens).toBe(52);
    });

    it('a three-round tool-loop turn reports MORE prompt tokens than a one-round turn, not less', async () => {
      const oneRoundFrame =
        'data: {"usage":{"prompt_tokens":18979,"completion_tokens":40},"choices":[{"delta":{}}]}\n\n';
      const oneRound = await relayAndAccumulate(streamFromChunks([oneRoundFrame]));

      const state = createCoachStreamAccumulateState();
      // Three separate rounds of the SAME turn, each its own full billed call — the exchange grows
      // every round, so the prompt genuinely gets bigger, never smaller or flat.
      for (const frame of [
        'data: {"usage":{"prompt_tokens":18979,"completion_tokens":40},"choices":[{"delta":{}}]}\n\n',
        'data: {"usage":{"prompt_tokens":19412,"completion_tokens":55},"choices":[{"delta":{}}]}\n\n',
        'data: {"usage":{"prompt_tokens":19800,"completion_tokens":63},"choices":[{"delta":{}}]}\n\n',
      ]) {
        await relayAndAccumulate(streamFromChunks([frame]), { state, suppressDone: true });
      }

      expect(state.promptTokens).toBeGreaterThan(oneRound.promptTokens!);
      expect(state.promptTokens).toBe(18979 + 19412 + 19800);
    });

    it('sums the v2 message.complete shape across rounds too, not just the OpenAI shape', async () => {
      const state = createCoachStreamAccumulateState();
      await relayAndAccumulate(
        streamFromChunks(['data: {"type":"message.complete","text":"a","inputTokens":12772,"outputTokens":9}\n\n']),
        { state, suppressDone: true },
      );
      const result = await relayAndAccumulate(
        streamFromChunks(['data: {"type":"message.complete","text":"b","inputTokens":13050,"outputTokens":14}\n\n']),
        { state, suppressDone: true },
      );

      expect(result.promptTokens).toBe(12772 + 13050);
      expect(result.completionTokens).toBe(9 + 14);
    });

    /**
     * CAPTURED OFF THE WIRE 2026-08-29 (`scripts/capture-turn-frames.ts`), because two separate
     * readings of this parser failed to explain what production was reporting and a third guess was
     * not worth making. The frames below are verbatim.
     *
     * Upstream emits `message.complete` for BOTH `response.completed` and `response.done`, so one
     * response arrives twice. Summing every frame made a turn report 30,510 cached tokens against
     * 24,081 prompt tokens — 127% of the prompt cached — byte-identically across separate runs.
     */
    describe('one response counted once, however many frames report it', () => {
      const frame = (o: Record<string, unknown>): string =>
        `data: ${JSON.stringify({ type: 'message.complete', text: '', ...o })}\n\n`;

      it('does not count a trailing duplicate that repeats cached tokens beside a zero prompt', async () => {
        const result = await relayAndAccumulate(
          streamFromChunks([
            frame({ inputTokens: 24081, cachedInputTokens: 15255, outputTokens: 139, responseId: 'resp_A' }),
            frame({ inputTokens: 0, cachedInputTokens: 15255, outputTokens: 0, responseId: 'resp_A' }),
          ]),
        );

        expect(result.promptTokens).toBe(24081);
        expect(result.cachedPromptTokens).toBe(15255);
      });

      it('does not count a duplicate that repeats the prompt as well', async () => {
        const result = await relayAndAccumulate(
          streamFromChunks([
            frame({ inputTokens: 23419, cachedInputTokens: 15255, outputTokens: 88, responseId: 'resp_B' }),
            frame({ inputTokens: 23419, outputTokens: 88, responseId: 'resp_B' }),
          ]),
        );

        expect(result.promptTokens).toBe(23419);
        expect(result.completionTokens).toBe(88);
      });

      /** The MP30 property, restated for distinct responses: real rounds must still add up. */
      it('still sums genuinely different responses in one turn', async () => {
        const result = await relayAndAccumulate(
          streamFromChunks([
            frame({ inputTokens: 23419, cachedInputTokens: 15255, outputTokens: 88, responseId: 'resp_C' }),
            frame({ inputTokens: 23419, outputTokens: 88, responseId: 'resp_C' }),
            frame({ inputTokens: 23602, cachedInputTokens: 15255, outputTokens: 26, responseId: 'resp_D' }),
          ]),
        );

        expect(result.promptTokens).toBe(23419 + 23602);
        expect(result.cachedPromptTokens).toBe(15255 + 15255);
        expect(result.completionTokens).toBe(88 + 26);
      });

      /**
       * The invariant that was missing. Cached tokens are a SUBSET of the prompt — a turn can never
       * cache more than it sent. Nothing checked it, so an impossible number reported itself for
       * weeks and read as a 127% cache rate rather than as a bug.
       */
      it('never reports more cached tokens than prompt tokens, across all three shapes', async () => {
        for (const frames of [
          [
            frame({ inputTokens: 24081, cachedInputTokens: 15255, outputTokens: 139, responseId: 'r1' }),
            frame({ inputTokens: 0, cachedInputTokens: 15255, outputTokens: 0, responseId: 'r1' }),
          ],
          [
            frame({ inputTokens: 23419, cachedInputTokens: 15255, outputTokens: 88, responseId: 'r2' }),
            frame({ inputTokens: 23419, outputTokens: 88, responseId: 'r2' }),
          ],
          [frame({ inputTokens: 22671, cachedInputTokens: 15255, outputTokens: 286, responseId: 'r3' })],
        ]) {
          const result = await relayAndAccumulate(streamFromChunks(frames));
          expect(result.cachedPromptTokens ?? 0).toBeLessThanOrEqual(result.promptTokens ?? 0);
        }
      });

      /** A first report of zero still has to move the field off `null` — silence and "nothing was
       *  cached" are different facts with different fixes, per `cachedPromptTokens`'s contract. */
      it('records a genuine first-report zero rather than leaving it null', async () => {
        const result = await relayAndAccumulate(
          streamFromChunks([frame({ inputTokens: 900, cachedInputTokens: 0, outputTokens: 5, responseId: 'resp_E' })]),
        );

        expect(result.cachedPromptTokens).toBe(0);
      });
    });

    it('leaves an accumulated total untouched when a later frame carries no usage at all', () => {
      const state = createCoachStreamAccumulateState();
      applySseDataPayload(state, JSON.stringify({ usage: { prompt_tokens: 5000, completion_tokens: 20 } }));
      // A delta-only frame — no `usage` key present at all, unlike the explicit-zero case above.
      applySseDataPayload(state, JSON.stringify({ choices: [{ delta: { content: 'more' } }] }));

      expect(state.promptTokens).toBe(5000);
      expect(state.completionTokens).toBe(20);
    });
  });
});
