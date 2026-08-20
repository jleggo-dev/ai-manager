import { DEFAULT_RUNTIME_OPTIONS, DEVS_AI_BUILTIN_TOOL_OPTIONS, normaliseRuntimeOptions } from './runtime-options';

describe('normaliseRuntimeOptions', () => {
  it('returns default options when called with no argument', () => {
    expect(normaliseRuntimeOptions()).toEqual(DEFAULT_RUNTIME_OPTIONS);
  });

  it('returns default options when called with null', () => {
    expect(normaliseRuntimeOptions(null)).toEqual(DEFAULT_RUNTIME_OPTIONS);
  });

  it('returns default options when called with a non-object (string)', () => {
    expect(normaliseRuntimeOptions('hello')).toEqual(DEFAULT_RUNTIME_OPTIONS);
  });

  it('returns default options when called with a non-object (number)', () => {
    expect(normaliseRuntimeOptions(42)).toEqual(DEFAULT_RUNTIME_OPTIONS);
  });

  it('preserves valid devs_ai.built_in_tools array', () => {
    const result = normaliseRuntimeOptions({
      devs_ai: { built_in_tools: ['web_search', 'python'] },
    });
    expect(result.devs_ai.built_in_tools).toEqual(['web_search', 'python']);
  });

  it('deduplicates and lowercases tool names', () => {
    const result = normaliseRuntimeOptions({
      devs_ai: { built_in_tools: ['Web_Search', 'WEB_SEARCH', 'Python'] },
    });
    expect(result.devs_ai.built_in_tools).toEqual(['web_search', 'python']);
  });

  it('filters empty strings from tool arrays', () => {
    const result = normaliseRuntimeOptions({
      devs_ai: { built_in_tools: ['python', '', '  ', 'memory'] },
    });
    expect(result.devs_ai.built_in_tools).toEqual(['python', 'memory']);
  });

  it('preserves devs_ai.generate_citations boolean', () => {
    const result = normaliseRuntimeOptions({
      devs_ai: { generate_citations: true },
    });
    expect(result.devs_ai.generate_citations).toBe(true);
  });

  it('treats non-boolean generate_citations as false', () => {
    const result = normaliseRuntimeOptions({
      devs_ai: { generate_citations: 'yes' },
    });
    expect(result.devs_ai.generate_citations).toBe(false);
  });

  it('preserves google_gemini.grounding_with_google_search', () => {
    const result = normaliseRuntimeOptions({
      google_gemini: { grounding_with_google_search: true },
    });
    expect(result.google_gemini.grounding_with_google_search).toBe(true);
  });

  it('handles partial input (only devs_ai provided, no google_gemini)', () => {
    const result = normaliseRuntimeOptions({
      devs_ai: { built_in_tools: ['sandbox'], generate_citations: true },
    });
    expect(result.devs_ai.built_in_tools).toEqual(['sandbox']);
    expect(result.devs_ai.generate_citations).toBe(true);
    expect(result.google_gemini.grounding_with_google_search).toBe(false);
  });
});

describe('DEFAULT_RUNTIME_OPTIONS', () => {
  it('has expected shape', () => {
    expect(DEFAULT_RUNTIME_OPTIONS).toEqual({
      devs_ai: {
        built_in_tools: [],
        generate_citations: false,
        parallel_tool_calls: false,
      },
      devs_ai_v2: {
        built_in_tools: [],
        parallel_tool_calls: true,
        chat_mode: 'execute',
        thread_mode: 'collect',
        threading: false,
      },
      google_gemini: {
        grounding_with_google_search: false,
      },
    });
  });
});

describe('DEVS_AI_BUILTIN_TOOL_OPTIONS', () => {
  it('each entry has key and label properties', () => {
    for (const option of DEVS_AI_BUILTIN_TOOL_OPTIONS) {
      expect(option).toHaveProperty('key');
      expect(option).toHaveProperty('label');
      expect(typeof option.key).toBe('string');
      expect(typeof option.label).toBe('string');
    }
  });
});
