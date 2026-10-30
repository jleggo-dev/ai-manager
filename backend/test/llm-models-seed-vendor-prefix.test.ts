/** Gateway ids are `vendor/model`; the catalogue sync has to file and label them sensibly. */
import { describe, it, expect } from 'vitest';
import { categorizeModel, prettifyModelId, splitVendorPrefix } from '../src/services/llm-models-seed.ts';

describe('vendor-prefixed model ids', () => {
  it.each([
    ['openai/gpt-4.1-mini', 'OpenAI'],
    ['anthropic/claude-sonnet-5.5', 'Anthropic'],
    ['google/gemini-3.6-flash', 'Google'],
    ['xai/grok-4.6', 'xAI'],
    ['gpt-4.1-mini', 'OpenAI'],
    ['claude-sonnet-5-5', 'Anthropic'],
  ])('categorizeModel(%s) → %s', (id, category) => {
    expect(categorizeModel(id)).toBe(category);
  });

  it('prettifies the model part and keeps the vendor visible', () => {
    expect(prettifyModelId('openai/gpt-4.1-mini')).toBe('Gpt 4.1 Mini (openai)');
    expect(prettifyModelId('gpt-4.1-mini')).toBe('Gpt 4.1 Mini');
  });

  it('splits only on the first slash and leaves a bare id alone', () => {
    expect(splitVendorPrefix('a/b/c')).toEqual({ vendor: 'a', rest: 'b/c' });
    expect(splitVendorPrefix('gpt-5.2')).toEqual({ vendor: null, rest: 'gpt-5.2' });
  });
});
