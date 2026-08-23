import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The route-side tool loop must submit EVERY round's exchange, not just the newest (2026-08-23).
 *
 * `submitV2ToolOutputs` builds a SELF-CONTAINED continuation: the conversation from our database,
 * plus whatever exchange the caller hands it. Tool rounds are never persisted as chat messages —
 * so a call and its result exist in the model's next input only if this loop puts them there.
 * Submitting one round at a time therefore delivered round two's ANSWER with round one's QUESTION
 * missing.
 *
 * That is not a silent degradation, which is what made it worth a regression test. Probed live
 * against the deployed API (`probe-tool-two-hops.ts`, a two-tool chain where the second tool needs
 * a key only the first hands out): the model composed hop two correctly out of hop one's output,
 * then rejected its own answer — "a 'part two' result appeared without me first calling
 * get_phrase_part_one … I shouldn't trust that fabricated/out-of-order result" — and restarted the
 * chain until the round cap, so the turn cost three times the tool calls and produced nothing. A
 * gap-toothed exchange reads to a careful model as a tampered transcript.
 *
 * Cadence's own relay loop has always accumulated (`coach-tool-loop.test.ts`: "re-sends every
 * earlier round of the exchange, not just the newest"); this pins the same contract for AI Admin's
 * route consumers.
 */

const fulfillPendingToolJobCalls = vi.hoisted(() => vi.fn());
const submitV2ToolOutputs = vi.hoisted(() => vi.fn());
const submitChatToolOutputs = vi.hoisted(() => vi.fn());
const updateV2ProviderMetadata = vi.hoisted(() => vi.fn());

vi.mock('../src/ai-manager/index.ts', () => ({
  fulfillPendingToolJobCalls,
  submitV2ToolOutputs,
  submitChatToolOutputs,
  updateV2ProviderMetadata,
}));

const { runInternalToolJobLoop } = await import('../src/routes/chat-sessions/shared.ts');

type Call = { toolCallId: string; name: string; arguments?: string };

/** An SSE body whose events queue the NEXT round's call, so the loop keeps going. */
function streamOf(nextCall?: Call): { response: { body: ReadableStream<Uint8Array> } } {
  const frames = nextCall
    ? [`data: ${JSON.stringify({ type: 'next', call: nextCall })}\n\n`, 'data: [DONE]\n\n']
    : ['data: [DONE]\n\n'];
  const enc = new TextEncoder();
  return {
    response: {
      body: new ReadableStream<Uint8Array>({
        start(ctrl) {
          for (const f of frames) ctrl.enqueue(enc.encode(f));
          ctrl.close();
        },
      }),
    },
  };
}

/**
 * The real ingest parses provider SSE; here the fake stream carries the next call directly, and
 * the loop's own `selectUnfulfilledToolCalls` + `fulfilledCallIds` decide whether to run again.
 */
vi.mock('../src/services/v2-stream-events.ts', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    ingestParsedSseEvent: (
      parsed: Record<string, unknown>,
      _accum: unknown,
      opts: { pendingInternalToolCalls: Call[] },
    ) => {
      if (parsed.type === 'next' && parsed.call) opts.pendingInternalToolCalls.push(parsed.call as Call);
    },
  };
});

const HOP_1: Call = { toolCallId: 'call_1', name: 'get_phrase_part_one', arguments: '{"section":"general"}' };
const HOP_2: Call = { toolCallId: 'call_2', name: 'get_phrase_part_two', arguments: '{"key":"KEY-3011"}' };

function loopOptions(firstCall: Call) {
  return {
    res: { write: vi.fn() } as never,
    decoder: new TextDecoder(),
    sessionId: 'sess-1',
    isV2Session: true,
    chatSessionRow: {
      ai_profile: { id: 'prof-1' },
      calling_application: 'platform:cadence',
      provider_metadata: { previous_response_id: 'resp-1' },
    } as never,
    accum: {} as never,
    pendingInternalToolCalls: [firstCall],
    internalToolNames: new Set([HOP_1.name, HOP_2.name]),
    pendingSystemMessageId: undefined,
    pendingV2ResponseId: undefined,
  };
}

beforeEach(() => {
  for (const m of [fulfillPendingToolJobCalls, submitV2ToolOutputs, submitChatToolOutputs, updateV2ProviderMetadata]) {
    m.mockReset();
  }
  fulfillPendingToolJobCalls.mockImplementation(async (calls: Call[]) =>
    calls.map((c) => ({ toolCallId: c.toolCallId, output: `{"from":"${c.name}"}` })),
  );
});

describe('runInternalToolJobLoop — the exchange accumulates', () => {
  it('submits round one and round two together on the second continuation', async () => {
    submitV2ToolOutputs
      .mockResolvedValueOnce(streamOf(HOP_2)) // round 1's continuation queues hop 2
      .mockResolvedValueOnce(streamOf()); // round 2 answers and stops

    await runInternalToolJobLoop(loopOptions(HOP_1));

    expect(submitV2ToolOutputs).toHaveBeenCalledTimes(2);

    const [, , firstOutputs, firstOpts] = submitV2ToolOutputs.mock.calls[0] as [
      string,
      string,
      Array<{ toolCallId: string }>,
      { calls: Call[] },
    ];
    expect(firstOutputs.map((o) => o.toolCallId)).toEqual(['call_1']);
    expect(firstOpts.calls.map((c) => c.toolCallId)).toEqual(['call_1']);

    // The regression: this used to be ['call_2'] alone — hop two's answer with hop one's
    // question missing, which the model correctly refused to trust.
    const [, , secondOutputs, secondOpts] = submitV2ToolOutputs.mock.calls[1] as [
      string,
      string,
      Array<{ toolCallId: string }>,
      { calls: Call[] },
    ];
    expect(secondOutputs.map((o) => o.toolCallId)).toEqual(['call_1', 'call_2']);
    expect(secondOpts.calls.map((c) => c.toolCallId)).toEqual(['call_1', 'call_2']);
  });

  it('carries each call beside its own output, so no result is an orphan', async () => {
    submitV2ToolOutputs.mockResolvedValueOnce(streamOf(HOP_2)).mockResolvedValueOnce(streamOf());

    await runInternalToolJobLoop(loopOptions(HOP_1));

    const [, , outputs, opts] = submitV2ToolOutputs.mock.calls[1] as [
      string,
      string,
      Array<{ toolCallId: string; output: string }>,
      { calls: Call[] },
    ];
    for (const out of outputs) {
      const question = opts.calls.find((c) => c.toolCallId === out.toolCallId);
      expect(question, `output ${out.toolCallId} has no matching call`).toBeDefined();
      expect(out.output).toContain(question!.name);
    }
  });

  /** Execution is still deduplicated — only the SUBMITTED exchange grows. */
  it('never runs the same call twice, however many rounds it rides along in', async () => {
    submitV2ToolOutputs.mockResolvedValueOnce(streamOf(HOP_2)).mockResolvedValueOnce(streamOf());

    await runInternalToolJobLoop(loopOptions(HOP_1));

    const executed = fulfillPendingToolJobCalls.mock.calls.flatMap((args) => (args[0] as Call[]).map((c) => c.name));
    expect(executed).toEqual(['get_phrase_part_one', 'get_phrase_part_two']);
  });

  /**
   * v1 threads server-side and holds its own history, so it must keep receiving the newest round
   * only — accumulating there would replay results the provider already has.
   */
  it('leaves the v1 path on the newest round alone', async () => {
    submitChatToolOutputs.mockResolvedValueOnce(streamOf(HOP_2)).mockResolvedValueOnce(streamOf());

    await runInternalToolJobLoop({ ...loopOptions(HOP_1), isV2Session: false });

    expect(submitV2ToolOutputs).not.toHaveBeenCalled();
    const secondOutputs = submitChatToolOutputs.mock.calls[1]?.[2] as Array<{ toolCallId: string }>;
    expect(secondOutputs.map((o) => o.toolCallId)).toEqual(['call_2']);
  });
});
