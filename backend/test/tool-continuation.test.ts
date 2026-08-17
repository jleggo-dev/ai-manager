import { describe, it, expect } from 'vitest';
import type { ChatMessage } from '../src/types.ts';
import { toolOutputsToV2Request, toolResultsToV2Request } from '../src/integrations/devs-ai-v2/request-builder.ts';

/**
 * The tool-result continuation (#232).
 *
 * For weeks the coach called a tool, we ran it, we posted the result, and the model never saw it.
 * Devs.ai answered 200 and dropped the `function_call_output` items: a continuation threaded on
 * `previous_response_id` gets its input rebuilt from the provider's own stored thread, which our
 * items never join. The measurement that settled it, on a live turn: round 1 billed 18,979 input
 * tokens; rounds 2, 3 and 4 each billed **12,772 — the same number three times**, with
 * byte-identical arguments. A prompt whose token count does not move is a prompt that did not
 * change. The 6,207-token shortfall was the dossier and the system prompt going missing.
 *
 * So the continuation stopped threading. These tests pin the payload that replaced it: the whole
 * conversation, then every call beside the result it got.
 */

const HISTORY: ChatMessage[] = [
  { role: 'system', content: 'You are Cadence. DOSSIER: constraints — left ankle tendinitis.' },
  { role: 'user', content: 'How did last week go?' },
  { role: 'assistant', content: 'Three sessions out of four.' },
  { role: 'user', content: 'Take the tendinitis off my file, it healed.' },
];

const EXCHANGE = [
  {
    toolCallId: 'call_a1',
    name: 'update_constraint',
    arguments: '{"constraint":"left ankle tendinitis","action":"lift"}',
    output: '{"ok":true,"lifted":"left ankle tendinitis"}',
  },
];

type Item = Record<string, unknown>;
const itemsOf = (input: unknown): Item[] => (Array.isArray(input) ? (input as Item[]) : []);

describe('toolResultsToV2Request — the continuation carries the conversation', () => {
  it('lifts the system prompt into instructions instead of losing it', () => {
    const body = toolResultsToV2Request('gpt-4.1', HISTORY, EXCHANGE);
    expect(body.instructions).toContain('DOSSIER: constraints — left ankle tendinitis');
  });

  it('replays every prior turn, so round two knows what round one was asked', () => {
    const body = toolResultsToV2Request('gpt-4.1', HISTORY, EXCHANGE);
    const text = JSON.stringify(body.input);
    expect(text).toContain('How did last week go?');
    expect(text).toContain('Three sessions out of four.');
    expect(text).toContain('Take the tendinitis off my file, it healed.');
  });

  /** An unthreaded output is an answer to a question the request does not contain. */
  it('pairs each function_call with its output, in that order, on the same call_id', () => {
    const items = itemsOf(toolResultsToV2Request('gpt-4.1', HISTORY, EXCHANGE).input);
    const callIdx = items.findIndex((i) => i.type === 'function_call');
    const outIdx = items.findIndex((i) => i.type === 'function_call_output');

    expect(callIdx).toBeGreaterThan(-1);
    expect(outIdx).toBe(callIdx + 1);
    expect(items[callIdx]).toMatchObject({
      call_id: 'call_a1',
      name: 'update_constraint',
      arguments: '{"constraint":"left ankle tendinitis","action":"lift"}',
    });
    expect(items[outIdx]).toMatchObject({
      call_id: 'call_a1',
      output: '{"ok":true,"lifted":"left ankle tendinitis"}',
    });
  });

  it('never threads — previous_response_id is dropped even when the caller passes one', () => {
    const body = toolResultsToV2Request('gpt-4.1', HISTORY, EXCHANGE, {
      previous_response_id: 'resp_abc',
      conversation: 'conv_abc',
    });
    expect(body.previous_response_id).toBeUndefined();
    expect(body.conversation).toBeUndefined();
  });

  it('re-declares the tools, or she can answer but not chain', () => {
    const tools = [{ type: 'function', function: { name: 'log_session', description: 'x', parameters: {} } }];
    const body = toolResultsToV2Request('gpt-4.1', HISTORY, EXCHANGE, { tools });
    expect(body.tools).toEqual([{ type: 'function', name: 'log_session', description: 'x', parameters: {} }]);
  });

  /**
   * Round three has to see round one. Accumulating the exchange is the loop's job
   * (coach-tool-loop.ts) but the payload is where it becomes visible, so it is pinned here too.
   */
  it('carries every round of a multi-round turn, not only the newest', () => {
    const items = itemsOf(
      toolResultsToV2Request('gpt-4.1', HISTORY, [
        { toolCallId: 'call_a1', name: 'find_tools', arguments: '{"query":"constraints"}', output: '{"names":[]}' },
        ...EXCHANGE,
      ]).input,
    );
    const ids = items.filter((i) => i.type === 'function_call_output').map((i) => i.call_id);
    expect(ids).toEqual(['call_a1', 'call_a1']);
    expect(items.filter((i) => i.type === 'function_call').map((i) => i.name)).toEqual([
      'find_tools',
      'update_constraint',
    ]);
  });

  it('a missing arguments string becomes {} rather than undefined, which the dialect rejects', () => {
    const items = itemsOf(
      toolResultsToV2Request('gpt-4.1', HISTORY, [{ toolCallId: 'c', name: 'get_plan', output: '{}' }]).input,
    );
    expect(items.find((i) => i.type === 'function_call')?.arguments).toBe('{}');
  });
});

/**
 * The shape that shipped for weeks, kept as the counter-example. Every assertion here is a thing
 * the request did NOT contain — which is precisely why the model answered as if no tool had run.
 */
describe('toolOutputsToV2Request — what the threaded continuation actually sent', () => {
  it('sends the results and nothing else: no instructions, no history', () => {
    const body = toolOutputsToV2Request('gpt-4.1', 'resp_abc', [{ toolCallId: 'call_a1', output: '{"ok":true}' }]);

    expect(body.instructions).toBeUndefined();
    expect(body.previous_response_id).toBe('resp_abc');
    expect(itemsOf(body.input)).toHaveLength(1);
    expect(itemsOf(body.input)[0]).toMatchObject({ type: 'function_call_output' });
    // Not one word of the conversation, and no record of what was even asked.
    expect(JSON.stringify(body.input)).not.toContain('update_constraint');
  });
});
