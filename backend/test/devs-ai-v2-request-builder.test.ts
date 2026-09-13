import { describe, it, expect } from 'vitest';
import {
  messagesToV2Request,
  normalizeToolsForV2,
  toV2InputContentPart,
  toolOutputsToV2Request,
} from '../src/integrations/devs-ai-v2/request-builder.ts';

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
    expect(body.input).toEqual([
      { type: 'function_call_output', call_id: 'toolu_abc', output: '{"word":"pineapple"}' },
    ]);
  });

  it('re-attaches tools so the model can chain another call', () => {
    const tools = [{ type: 'function', function: { name: 'echo_word', description: 'd', parameters: {} } }];
    const body = toolOutputsToV2Request('m', 'r', [{ toolCallId: 't', output: 'o' }], { tools });
    expect(Array.isArray(body.tools)).toBe(true);
    expect(body.tools).toHaveLength(1);
  });

  it('never emits the /resume dialect (camelCase toolOutputs)', () => {
    const body = toolOutputsToV2Request('m', 'r', [{ toolCallId: 't', output: 'o' }]) as unknown as Record<
      string,
      unknown
    >;
    expect(body.toolOutputs).toBeUndefined();
    expect(body.reason).toBeUndefined();
  });
});

/**
 * Documents on a turn (owner, 2026-09-11). The Devs.ai spec's `InputContentPart` union is
 * `input_text` | `input_image` | `input_file`, and `input_file` takes `file_id` or `file_data`
 * plus `filename` — there is no `file_url`. Pinned so a provider-side rename shows up here first.
 */
describe('toV2InputContentPart / messagesToV2Request with file parts', () => {
  it('maps a file part by id, and inline data as a data URL', () => {
    expect(
      toV2InputContentPart({ type: 'file', filename: 'labs.pdf', mimeType: 'application/pdf', fileId: 'file_9' }),
    ).toEqual({ type: 'input_file', filename: 'labs.pdf', file_id: 'file_9' });
    expect(
      toV2InputContentPart({ type: 'file', filename: 'n.pdf', mimeType: 'application/pdf', data: 'QUJD' }),
    ).toEqual({ type: 'input_file', filename: 'n.pdf', file_data: 'data:application/pdf;base64,QUJD' });
    expect(toV2InputContentPart({ type: 'image_url', url: 'https://s/1.jpg' })).toEqual({
      type: 'input_image',
      image_url: 'https://s/1.jpg',
    });
  });

  it('keeps a multimodal user turn inside an input-items array (never the bare-string shortcut)', () => {
    const body = messagesToV2Request('m', [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'read this' },
          { type: 'file', filename: 'labs.pdf', mimeType: 'application/pdf', fileId: 'file_9' },
        ],
      },
    ]);
    expect(Array.isArray(body.input)).toBe(true);
    expect((body.input as Array<Record<string, unknown>>)[0]).toEqual({
      role: 'user',
      content: [
        { type: 'input_text', text: 'read this' },
        { type: 'input_file', filename: 'labs.pdf', file_id: 'file_9' },
      ],
    });
  });
});
