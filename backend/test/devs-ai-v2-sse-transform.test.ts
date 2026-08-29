import { describe, it, expect } from 'vitest';
import { createSseTransformState, transformV2SseDataLine } from '../src/integrations/devs-ai-v2/sse-transform.ts';

describe('devs-ai-v2 SSE transform', () => {
  it('maps output_text.delta to OpenAI chat delta shape', () => {
    const state = createSseTransformState();
    const lines = transformV2SseDataLine(JSON.stringify({ type: 'response.output_text.delta', delta: 'Hello' }), state);
    expect(state.fullText).toBe('Hello');
    expect(lines.some((l) => l.includes('choices') && l.includes('Hello'))).toBe(true);
  });

  it('emits message.complete with responseId on response.completed', () => {
    const state = createSseTransformState();
    transformV2SseDataLine(JSON.stringify({ type: 'response.output_text.delta', delta: 'Done' }), state);
    const lines = transformV2SseDataLine(
      JSON.stringify({
        type: 'response.completed',
        sequence_number: 42,
        response: {
          id: 'resp_abc',
          model: 'gpt-test',
          usage: { input_tokens: 10, output_tokens: 5 },
          conversation: { id: 'conv_xyz' },
        },
      }),
      state,
    );
    const completeLine = lines.find((l) => l.includes('message.complete'));
    expect(completeLine).toBeTruthy();
    if (!completeLine) return;
    const payload = JSON.parse(completeLine.replace('data: ', '').trim());
    expect(payload.text).toBe('Done');
    expect(payload.responseId).toBe('resp_abc');
    expect(payload.conversationId).toBe('conv_xyz');
    expect(payload.lastSequence).toBe(42);
    expect(payload.inputTokens).toBe(10);
    expect(payload.outputTokens).toBe(5);
  });

  it('forwards v2.response.created for tool-loop threading', () => {
    const state = createSseTransformState();
    const lines = transformV2SseDataLine(
      JSON.stringify({
        type: 'response.created',
        response: { id: 'resp_new' },
      }),
      state,
    );
    expect(state.responseId).toBe('resp_new');
    expect(lines.some((l) => l.includes('v2.response.created'))).toBe(true);
  });
});

/**
 * Prompt-cache reporting — the number nobody was reading.
 *
 * `input_tokens_details.cached_tokens` has been in `V2Usage` all along and no code anywhere read
 * it, so "22,869 prompt tokens per coach turn" could never be distinguished from what was actually
 * billed. A coach turn carries a byte-identical ~9,600-token prefix (persona + tool definitions) on
 * every message — exactly the shape an automatic prefix cache exists for — so the difference is not
 * academic.
 *
 * The distinction these tests defend is `null` versus `0`. Silence from the provider and an
 * explicit "nothing was cached" are different findings with different fixes: the first means the
 * pass-through does not work, the second means it works and the prefix is not being reused.
 * Collapsing them would answer the question wrongly in the more encouraging direction.
 */
describe('devs-ai-v2 SSE transform — cached prompt tokens', () => {
  const complete = (usage: unknown): { state: ReturnType<typeof createSseTransformState>; lines: string[] } => {
    const state = createSseTransformState();
    const lines = transformV2SseDataLine(
      JSON.stringify({ type: 'response.completed', response: { id: 'resp_1', usage } }),
      state,
    );
    return { state, lines };
  };

  const completeFrame = (lines: string[]): Record<string, unknown> => {
    const frame = lines.find((l) => l.includes('message.complete'));
    if (!frame) throw new Error('no message.complete frame was emitted');
    return JSON.parse(frame.replace(/^data: /, '').trim());
  };

  it('reads cached_tokens off the usage detail block', () => {
    const { state, lines } = complete({
      input_tokens: 22869,
      output_tokens: 300,
      input_tokens_details: { cached_tokens: 9600 },
    });
    expect(state.cachedInputTokens).toBe(9600);
    expect(completeFrame(lines).cachedInputTokens).toBe(9600);
  });

  it('keeps an explicit zero — that is the provider saying nothing was cached', () => {
    const { state } = complete({
      input_tokens: 22869,
      input_tokens_details: { cached_tokens: 0 },
    });
    expect(state.cachedInputTokens).toBe(0);
    expect(state.cachedInputTokens).not.toBeNull();
  });

  it('stays null when the provider omits the detail block entirely', () => {
    const { state, lines } = complete({ input_tokens: 22869, output_tokens: 300 });
    expect(state.cachedInputTokens).toBeNull();
    expect(completeFrame(lines).cachedInputTokens).toBeNull();
  });

  /**
   * CAPTURED OFF THE WIRE 2026-08-29. Upstream emits BOTH `response.completed` and `response.done`
   * for a single response, and the second carries `input_tokens: 0` with no detail block:
   *
   *     message.complete{inputTokens:24081, cachedInputTokens:15255} resp=4fc60fcb82c1
   *     message.complete{inputTokens:0,     cachedInputTokens:15255} resp=4fc60fcb82c1
   *
   * The old `if (cached != null)` guard kept the first event's figure and re-emitted it beside the
   * zero prompt, and the consumer summed both — reporting 30,510 cached against 24,081 prompt,
   * i.e. 127% of the prompt cached. A response reporting usage and no cached detail cached nothing.
   */
  it("does not repeat the previous response's cached figure on a second event for the same response", () => {
    const state = createSseTransformState();
    const say = (usage: unknown): string[] =>
      transformV2SseDataLine(JSON.stringify({ type: 'response.completed', response: { id: 'resp_1', usage } }), state);

    const first = say({ input_tokens: 24081, output_tokens: 139, input_tokens_details: { cached_tokens: 15255 } });
    expect(completeFrame(first).cachedInputTokens).toBe(15255);

    // The `response.done` twin: usage present, detail block absent.
    const second = say({ input_tokens: 0, output_tokens: 0 });
    expect(completeFrame(second).cachedInputTokens).toBeNull();
    expect(state.cachedInputTokens).toBeNull();
  });

  it('does not disturb the input/output counts it sits beside', () => {
    const { state } = complete({
      input_tokens: 100,
      output_tokens: 20,
      input_tokens_details: { cached_tokens: 40 },
    });
    expect(state.inputTokens).toBe(100);
    expect(state.outputTokens).toBe(20);
  });
});
