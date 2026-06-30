import { describe, it, expect } from 'vitest';
import { buildProviderChatOptions, normaliseAiProfileRuntimeOptions } from '../src/services/ai-profile-runtime-options.ts';

describe('devs-ai-v2 runtime options', () => {
  it('normalises devs_ai_v2 section', () => {
    const opts = normaliseAiProfileRuntimeOptions('devs-ai-v2', {
      devs_ai_v2: {
        built_in_tools: ['web_search', 'python'],
        chat_mode: 'chat',
        thread_mode: 'steer',
        parallel_tool_calls: false,
      },
    });
    expect(opts.devs_ai_v2.built_in_tools).toEqual(['web_search', 'python']);
    expect(opts.devs_ai_v2.chat_mode).toBe('chat');
    expect(opts.devs_ai_v2.thread_mode).toBe('steer');
    expect(opts.devs_ai_v2.parallel_tool_calls).toBe(false);
  });

  it('buildProviderChatOptions maps v2 fragments and expectedSchema', () => {
    const chatOpts = buildProviderChatOptions(
      'devs-ai-v2',
      {
        devs_ai_v2: {
          built_in_tools: ['python'],
          chat_mode: 'execute',
          thread_mode: 'collect',
        },
      },
      {
        previousResponseId: 'resp_prev',
        conversationId: 'conv_1',
        expectedSchema: {
          fields: { answer: { type: 'string', required: true } },
        },
      },
    );

    expect(chatOpts.chat_mode).toBe('execute');
    expect(chatOpts.thread_mode).toBe('collect');
    expect(chatOpts.previous_response_id).toBe('resp_prev');
    expect(chatOpts.conversation).toBe('conv_1');
    expect(chatOpts.tools).toEqual([{ type: 'python' }]);
    expect(chatOpts.text).toMatchObject({
      format: { type: 'json_schema', strict: true },
    });
  });
});
