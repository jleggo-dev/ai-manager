import { describe, it, expect } from 'vitest';
import { normalizeToolsForV2, toolOutputsToV2Request } from '../src/integrations/devs-ai-v2/request-builder.ts';

describe('normalizeToolsForV2', () => {
  it('flattens Chat Completions function tool shape for Responses API', () => {
    const result = normalizeToolsForV2([
      {
        type: 'function',
        function: {
          name: 'echo_ping',
          description: 'Echo input',
          parameters: { type: 'object', properties: { input: { type: 'string' } } },
        },
      },
    ]);
    expect(result[0]).toEqual({
      type: 'function',
      name: 'echo_ping',
      description: 'Echo input',
      parameters: { type: 'object', properties: { input: { type: 'string' } } },
    });
  });
});

/**
 * The function-call continuation body (probe-tool-loop.ts, 2026-08-14): NOT /resume — a NEW
 * response threaded on previous_response_id whose input items are the function results, tools
 * riding again so the model can chain. These pin the exact shape Devs.ai accepted live.
 */
describe('toolOutputsToV2Request', () => {
  it('threads the prior response and carries function_call_output items', () => {
    const body = toolOutputsToV2Request('anthropic-claude-4-5-sonnet', 'resp_123', [
      { toolCallId: 'toolu_abc', output: '{"word":"pineapple"}' },
    ]);
    expect(body.previous_response_id).toBe('resp_123');
    expect(body.stream).toBe(true);
    expect(body.model).toBe('anthropic-claude-4-5-sonnet');
    expect(body.input).toEqual([{ type: 'function_call_output', call_id: 'toolu_abc', output: '{"word":"pineapple"}' }]);
  });

  it('re-attaches tools so the model can chain another call', () => {
    const tools = [{ type: 'function', function: { name: 'echo_word', description: 'd', parameters: {} } }];
    const body = toolOutputsToV2Request('m', 'r', [{ toolCallId: 't', output: 'o' }], { tools });
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tools).toHaveLength(1);
  });

  it('never emits the /resume dialect (camelCase toolOutputs)', () => {
    const body = toolOutputsToV2Request('m', 'r', [{ toolCallId: 't', output: 'o' }]) as unknown as Record<string, unknown>;
    expect(body.toolOutputs).toBeUndefined();
    expect(body.reason).toBeUndefined();
  });
});
