import { describe, it, expect } from 'vitest';
import {
  buildProviderChatOptions,
  normaliseAiProfileRuntimeOptions,
  providerEnforcesSchema,
} from '../src/services/ai-profile-runtime-options.ts';

describe('vercel-ai-gateway runtime options', () => {
  it('zeroes every other provider fragment, so nothing Devs.ai-shaped rides along', () => {
    const opts = normaliseAiProfileRuntimeOptions('vercel-ai-gateway', {
      devs_ai_v2: { built_in_tools: ['web_search'], chat_mode: 'chat', threading: true },
      google_gemini: { grounding_with_google_search: true },
    });
    expect(opts.devs_ai_v2.built_in_tools).toEqual([]);
    expect(opts.devs_ai_v2.threading).toBe(false);
    expect(opts.google_gemini.grounding_with_google_search).toBe(false);
  });

  it('buildProviderChatOptions carries only the schema — no chat_mode, no threading, no tools', () => {
    const chatOpts = buildProviderChatOptions(
      'vercel-ai-gateway',
      { devs_ai_v2: { built_in_tools: ['python'], chat_mode: 'execute' } },
      { previousResponseId: 'resp_prev', expectedSchema: { fields: { answer: { type: 'string' } } } },
    );
    expect(Object.keys(chatOpts)).toEqual(['text']);
    expect(chatOpts.text).toMatchObject({ format: { type: 'json_schema' } });
  });

  it('buildProviderChatOptions is empty without a schema', () => {
    expect(buildProviderChatOptions('vercel-ai-gateway', {}, {})).toEqual({});
  });
});

describe('providerEnforcesSchema — which types take expectedSchema natively', () => {
  it.each([
    ['devs-ai-v2', true],
    ['vercel-ai-gateway', true],
    [' Vercel-AI-Gateway ', true],
    ['devs-ai', false],
    ['google-gemini', false],
    ['vercel', false],
    ['', false],
    [undefined, false],
  ])('%j → %s', (type, expected) => {
    expect(providerEnforcesSchema(type as string)).toBe(expected);
  });
});
