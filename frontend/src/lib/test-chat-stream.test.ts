import { describe, it, expect } from 'vitest';
import {
  friendlyToolName,
  finalizeStreamingMessages,
  appendStreamError,
  applyAssistantDelta,
  buildToolsPresetPrompt,
  extractTextDelta,
  type TestChatMessage,
} from './test-chat-stream';
import type { AiProfile, Provider } from '../types/api';

function providerStub(type: string): Provider {
  return {
    id: 'prov-1',
    name: type,
    type,
    base_url: 'https://example.com',
    is_active: true,
    request_timeout_ms: null,
    workspace_id: 'ws-1',
    created_at: '',
    updated_at: '',
  };
}

function profileStub(overrides: Partial<AiProfile> = {}): AiProfile {
  return {
    id: 'p1',
    name: 'Test',
    mode: 'chat',
    provider_id: 'prov-1',
    external_ai_id: 'model-1',
    is_active: true,
    is_default: false,
    workspace_id: 'ws-1',
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

describe('friendlyToolName', () => {
  it('returns the last MCP segment', () => {
    expect(friendlyToolName('mcp__gmail__send')).toBe('send');
    expect(friendlyToolName('mcp__fs__listFiles')).toBe('listFiles');
  });

  it('falls back for short or missing types', () => {
    expect(friendlyToolName('web_search')).toBe('web_search');
    expect(friendlyToolName(null)).toBe('unknown tool');
    expect(friendlyToolName(undefined)).toBe('unknown tool');
  });
});

describe('finalizeStreamingMessages', () => {
  it('clears streaming on the last assistant bubble', () => {
    const msgs: TestChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello', streaming: true },
    ];
    const out = finalizeStreamingMessages(msgs);
    expect(out[1]).toEqual({ role: 'assistant', content: 'hello', streaming: false });
    expect(msgs[1]?.streaming).toBe(true);
  });
});

describe('appendStreamError', () => {
  it('drops empty streaming placeholders before appending error', () => {
    const msgs: TestChatMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: '', streaming: true },
    ];
    expect(appendStreamError(msgs, 'Error: boom')).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'error', content: 'Error: boom' },
    ]);
  });
});

describe('applyAssistantDelta', () => {
  it('updates an existing streaming assistant message', () => {
    const msgs: TestChatMessage[] = [{ role: 'assistant', content: 'Hel', streaming: true }];
    expect(applyAssistantDelta(msgs, 'Hello')).toEqual([{ role: 'assistant', content: 'Hello', streaming: true }]);
  });

  it('creates a streaming assistant message when needed', () => {
    expect(applyAssistantDelta([{ role: 'user', content: 'hi' }], 'Hey')).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'Hey', streaming: true },
    ]);
  });
});

describe('extractTextDelta', () => {
  it('reads OpenAI-shaped choices.delta.content', () => {
    expect(extractTextDelta({ choices: [{ delta: { content: 'abc' } }] })).toBe('abc');
  });

  it('reads Gemini-shaped candidates parts text', () => {
    expect(
      extractTextDelta({
        candidates: [{ content: { parts: [{ text: 'gem' }] } }],
      }),
    ).toBe('gem');
  });

  it('reads string or object content fallbacks', () => {
    expect(extractTextDelta({ content: 'plain' })).toBe('plain');
    expect(extractTextDelta({ content: { text: 'obj' } })).toBe('obj');
  });
});

describe('buildToolsPresetPrompt', () => {
  it('lists enabled Devs.ai tools', () => {
    const prompt = buildToolsPresetPrompt(
      profileStub({
        provider: providerStub('devs-ai'),
        runtime_options: { devs_ai: { built_in_tools: ['web_search', 'python'] } },
      }),
    );
    expect(prompt).toContain('Enabled tools configured on this profile: web_search, python.');
    expect(prompt).toContain('Return compact JSON');
  });

  it('uses grounding smoke copy for Gemini with search on', () => {
    const prompt = buildToolsPresetPrompt(
      profileStub({
        provider: providerStub('google-gemini'),
        runtime_options: { google_gemini: { grounding_with_google_search: true } },
      }),
    );
    expect(prompt).toContain('Run a grounding smoke test.');
    expect(prompt).toContain('grounding was used');
  });

  it('uses non-grounded copy when Gemini search is off', () => {
    const prompt = buildToolsPresetPrompt(
      profileStub({
        provider: providerStub('google-gemini'),
        runtime_options: { google_gemini: { grounding_with_google_search: false } },
      }),
    );
    expect(prompt).toContain('Run a non-grounded response smoke test.');
  });

  it('falls back for unknown providers', () => {
    const prompt = buildToolsPresetPrompt(
      profileStub({
        provider: providerStub('openai'),
      }),
    );
    expect(prompt).toContain('Run a basic tool/runtime smoke test');
  });
});
