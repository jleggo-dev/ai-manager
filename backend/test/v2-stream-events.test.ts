import { describe, it, expect } from 'vitest';
import {
  extractFunctionCallsFromOutput,
  ingestParsedSseEvent,
  mergeCompleteText,
  selectUnfulfilledToolCalls,
  type ChatStreamAccum,
} from '../src/services/v2-stream-events.ts';
import type { PendingToolCall } from '../src/services/tool-jobs.ts';

describe('v2-stream-events', () => {
  it('mergeCompleteText appends continuation without duplicating', () => {
    expect(mergeCompleteText('Hello', ' world')).toBe('Hello world');
    expect(mergeCompleteText('Hello world', 'Hello world')).toBe('Hello world');
    expect(mergeCompleteText('', 'Done')).toBe('Done');
  });

  it('extractFunctionCallsFromOutput reads function_call items', () => {
    const calls = extractFunctionCallsFromOutput([
      { type: 'message', role: 'assistant' },
      { type: 'function_call', call_id: 'c1', name: 'echo', arguments: '{"x":1}' },
    ]);
    expect(calls).toEqual([{ toolCallId: 'c1', name: 'echo', arguments: '{"x":1}' }]);
  });

  it('ingestParsedSseEvent accumulates deltas and queues tool calls', () => {
    const accum: ChatStreamAccum = {
      fullContent: '',
      promptTokens: null,
      completionTokens: null,
      streamModel: null,
    };
    const pending: PendingToolCall[] = [];
    const opts = {
      isV2Session: true,
      internalToolNames: new Set(['echo_ping']),
      pendingInternalToolCalls: pending,
      fulfilledCallIds: new Set<string>(),
    };

    ingestParsedSseEvent({ choices: [{ delta: { content: 'Hi' } }] }, accum, opts);
    expect(accum.fullContent).toBe('Hi');

    ingestParsedSseEvent(
      {
        type: 'response.output_item.done',
        item: { type: 'function_call', call_id: 'call_1', name: 'echo_ping', arguments: '{}' },
      },
      accum,
      opts,
    );
    expect(pending).toHaveLength(1);
    expect(pending[0]?.name).toBe('echo_ping');
  });

  it('selectUnfulfilledToolCalls skips fulfilled ids', () => {
    const pending: PendingToolCall[] = [{ toolCallId: 'a', name: 't1' }];
    const fulfilled = new Set(['a']);
    expect(selectUnfulfilledToolCalls(pending, new Set(['t1']), fulfilled)).toHaveLength(0);
    expect(selectUnfulfilledToolCalls(pending, new Set(['t1']), new Set())).toHaveLength(1);
  });
});
