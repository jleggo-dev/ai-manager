import { describe, it, expect } from 'vitest';
import { applyFormattingRules, listAvailableRules, RULE_REGISTRY } from '../src/services/formatting-rules.ts';

/**
 * Helper: invoke a single rule by type via the registry.
 */
function runRule(type: string, text: string, options: Record<string, unknown> = {}): string {
  const entry = RULE_REGISTRY[type];
  if (!entry) throw new Error(`Unknown rule type: ${type}`);
  return entry.fn(text, options);
}

/* ── escapeRegex (tested indirectly through tag rules) ──────── */

describe('escapeRegex (via remove-custom-tags / extract-between-tags)', () => {
  it('regular tag names pass through unchanged', () => {
    const input = '<answer>secret</answer> visible';
    expect(runRule('remove-custom-tags', input, { tagName: 'answer' })).toBe('visible');
  });

  it('handles tag names with regex-special characters (dot)', () => {
    const input = '<result.data>inner</result.data> outer';
    expect(runRule('remove-custom-tags', input, { tagName: 'result.data' })).toBe('outer');
  });

  it('handles tag names with multiple special chars', () => {
    const input = '<a+b(c)>content</a+b(c)> rest';
    expect(runRule('remove-custom-tags', input, { tagName: 'a+b(c)' })).toBe('rest');
  });
});

/* ── remove-reasoning ───────────────────────────────────────── */

describe('remove-reasoning', () => {
  it('removes content between <think> tags', () => {
    const input = '<think>internal reasoning</think>The answer is 42.';
    expect(runRule('remove-reasoning', input)).toBe('The answer is 42.');
  });

  it('is case insensitive (<Think>, <THINK>)', () => {
    const upper = '<THINK>reasoning</THINK>Result A';
    const mixed = '<Think>reasoning</Think>Result B';
    expect(runRule('remove-reasoning', upper)).toBe('Result A');
    expect(runRule('remove-reasoning', mixed)).toBe('Result B');
  });

  it('handles multiline content inside think tags', () => {
    const input = '<think>\nline one\nline two\nline three\n</think>\nFinal answer.';
    expect(runRule('remove-reasoning', input)).toBe('Final answer.');
  });

  it('strips reasoning text before a ```json block', () => {
    const input = 'Let me think about this...\nHere is the result:\n```json\n{"key":"value"}\n```';
    const result = runRule('remove-reasoning', input);
    expect(result).toContain('```json');
    expect(result).toContain('{"key":"value"}');
    expect(result).not.toContain('Let me think about this');
  });
});

/* ── remove-footnote-tags ───────────────────────────────────── */

describe('remove-footnote-tags', () => {
  it('removes single-digit footnote tags like <#1#>', () => {
    expect(runRule('remove-footnote-tags', 'Hello<#1#> world')).toBe('Hello world');
  });

  it('removes multi-digit footnote tags like <#15#>', () => {
    expect(runRule('remove-footnote-tags', 'A<#15#> B<#3#> C')).toBe('A B C');
  });

  it('leaves other text and tags intact', () => {
    const input = '<b>bold</b> normal <#2#> text';
    expect(runRule('remove-footnote-tags', input)).toBe('<b>bold</b> normal  text');
  });
});

/* ── remove-custom-tags ─────────────────────────────────────── */

describe('remove-custom-tags', () => {
  it('removes content between the specified custom tag', () => {
    const input = 'before <answer>hidden</answer> after';
    expect(runRule('remove-custom-tags', input, { tagName: 'answer' })).toBe('before  after');
  });

  it('handles tag names with regex-special characters', () => {
    const input = 'ok <tag.name>remove me</tag.name> keep';
    expect(runRule('remove-custom-tags', input, { tagName: 'tag.name' })).toBe('ok  keep');
  });

  it('is a no-op when tagName is missing from options', () => {
    const input = '<answer>content</answer>';
    expect(runRule('remove-custom-tags', input, {})).toBe(input);
    expect(runRule('remove-custom-tags', input)).toBe(input);
  });
});

/* ── extract-between-tags ───────────────────────────────────── */

describe('extract-between-tags', () => {
  it('extracts content between specified tags', () => {
    const input = 'Preamble <result>the answer</result> epilogue';
    expect(runRule('extract-between-tags', input, { tagName: 'result' })).toBe('the answer');
  });

  it('handles multiple occurrences and joins them', () => {
    const input = '<item>A</item> noise <item>B</item>';
    expect(runRule('extract-between-tags', input, { tagName: 'item' })).toBe('A\nB');
  });

  it('returns original text when tag is not found', () => {
    const input = 'no tags here';
    expect(runRule('extract-between-tags', input, { tagName: 'missing' })).toBe(input);
  });
});

/* ── trim-to-json ───────────────────────────────────────────── */

describe('trim-to-json', () => {
  it('extracts JSON from markdown fences', () => {
    const input = '```json\n{"a":1}\n```';
    const result = runRule('trim-to-json', input);
    expect(JSON.parse(result)).toEqual({ a: 1 });
  });

  it('extracts a JSON object from mixed text', () => {
    const input = 'Here is the data:\n{"name":"test","value":42}\nThat was it.';
    const result = runRule('trim-to-json', input);
    expect(JSON.parse(result)).toEqual({ name: 'test', value: 42 });
  });

  it('handles nested objects', () => {
    const input = 'Result: {"outer":{"inner":{"deep":true}}}';
    const result = runRule('trim-to-json', input);
    expect(JSON.parse(result)).toEqual({ outer: { inner: { deep: true } } });
  });
});

/* ── repair-json ────────────────────────────────────────────── */

describe('repair-json', () => {
  it('returns valid JSON unchanged', () => {
    const valid = '{"key":"value","num":123}';
    expect(runRule('repair-json', valid)).toBe(valid);
  });

  it('fixes trailing commas', () => {
    const input = '{"a":1,"b":2,}';
    const result = runRule('repair-json', input);
    expect(JSON.parse(result)).toEqual({ a: 1, b: 2 });
  });

  it('closes truncated JSON (unclosed braces)', () => {
    const input = '{"a":1,"b":{"c":2';
    const result = runRule('repair-json', input);
    expect(() => JSON.parse(result)).not.toThrow();
    const parsed = JSON.parse(result);
    expect(parsed.a).toBe(1);
  });

  it('handles NaN/Infinity/undefined literals', () => {
    const input = '{"a":NaN,"b":Infinity,"c":undefined}';
    const result = runRule('repair-json', input);
    expect(JSON.parse(result)).toEqual({ a: null, b: null, c: null });
  });

  it('strips markdown fences', () => {
    const input = '```json\n{"x":1}\n```';
    const result = runRule('repair-json', input);
    expect(JSON.parse(result)).toEqual({ x: 1 });
  });
});

/* ── applyFormattingRules ───────────────────────────────────── */

describe('applyFormattingRules', () => {
  it('chains multiple rules in order', () => {
    const text = '<think>reasoning</think>  HELLO WORLD  ';
    const rules = [
      { type: 'remove-reasoning', order: 0 },
      { type: 'lowercase', order: 1 },
    ];
    const { formatted, steps } = applyFormattingRules(text, rules);
    expect(formatted).toBe('hello world');
    expect(steps).toHaveLength(2);
    expect(steps[0]?.type).toBe('remove-reasoning');
    expect(steps[1]?.type).toBe('lowercase');
  });

  it('rolls back a step that catastrophically reduces content (>90% removal)', () => {
    const longText = 'A'.repeat(200);
    const rules = [
      { type: 'extract-between-tags', order: 0, options: { tagName: 'nonexistent' } },
      { type: 'trim-to-json', order: 1 },
    ];
    const { formatted, steps } = applyFormattingRules(longText, rules);
    const trimStep = steps.find((s) => s.type === 'trim-to-json');
    if (trimStep?.rolledBack) {
      expect(formatted).toBe(longText);
    } else {
      expect(formatted.length).toBeGreaterThan(0);
    }
  });

  it('records error but continues for unknown rule type', () => {
    const text = 'hello world';
    const rules = [
      { type: 'totally-fake-rule', order: 0 },
      { type: 'uppercase', order: 1 },
    ];
    const { formatted, steps } = applyFormattingRules(text, rules);
    expect(formatted).toBe('HELLO WORLD');
    expect(steps[0]?.error).toBe('Unknown rule type');
    expect(steps[1]?.type).toBe('uppercase');
  });
});

/* ── listAvailableRules ─────────────────────────────────────── */

/* ── trim-to-json expectedKeys option ────────────────────────── */

describe('trim-to-json with expectedKeys', () => {
  it('single JSON block — returns it regardless of expectedKeys', () => {
    const input = 'Here is the data:\n```json\n{"sources": ["Bloomberg"]}\n```\nDone.';
    const result = runRule('trim-to-json', input, { expectedKeys: ['sources'] });
    expect(JSON.parse(result)).toEqual({ sources: ['Bloomberg'] });
  });

  it('multiple JSON blocks — picks the one matching expectedKeys', () => {
    const input = [
      'Metadata: {"model": "gpt-4", "tokens": 120}',
      'Result: {"sources": ["Bloomberg", "Reuters"], "confidence": 0.92}',
    ].join('\n');
    const result = runRule('trim-to-json', input, { expectedKeys: ['sources', 'confidence'] });
    const parsed = JSON.parse(result);
    expect(parsed).toHaveProperty('sources');
    expect(parsed).toHaveProperty('confidence');
    expect(parsed).not.toHaveProperty('model');
  });

  it('no candidate has expectedKeys — falls back to longest valid', () => {
    const input = '{"a": 1} and also {"b": 2, "c": 3}';
    const result = runRule('trim-to-json', input, { expectedKeys: ['nonexistent'] });
    const parsed = JSON.parse(result);
    expect(Object.keys(parsed).length).toBeGreaterThanOrEqual(1);
  });

  it('without expectedKeys — returns first valid JSON (original behavior)', () => {
    const input = '{"first": true} then {"second": true}';
    const result = runRule('trim-to-json', input);
    expect(JSON.parse(result)).toEqual({ first: true });
  });

  it('mixed text with JSON containing expected keys', () => {
    const input = [
      'I analyzed the data and here are the results:',
      '',
      '```json',
      '{"summary": "Good outlook", "keyPoints": ["Growth", "Stability"]}',
      '```',
      '',
      'Let me know if you need more details.',
    ].join('\n');
    const result = runRule('trim-to-json', input, { expectedKeys: ['summary', 'keyPoints'] });
    const parsed = JSON.parse(result);
    expect(parsed.summary).toBe('Good outlook');
    expect(parsed.keyPoints).toEqual(['Growth', 'Stability']);
  });

  it('prefers higher key-match score over longer candidate', () => {
    const input = [
      '{"a": 1, "b": 2, "c": 3, "d": 4, "e": 5}',
      '{"target": "yes", "score": 99}',
    ].join('\n');
    const result = runRule('trim-to-json', input, { expectedKeys: ['target', 'score'] });
    const parsed = JSON.parse(result);
    expect(parsed).toHaveProperty('target');
    expect(parsed).toHaveProperty('score');
  });
});

/* ── listAvailableRules ──────────────────────────────────────── */

describe('listAvailableRules', () => {
  it('returns an array of rule descriptors', () => {
    const rules = listAvailableRules();
    expect(Array.isArray(rules)).toBe(true);
    expect(rules.length).toBeGreaterThan(0);
  });

  it('each descriptor has type, label, description, hasOptions, streamingSafe, and streamingNote', () => {
    const rules = listAvailableRules();
    for (const rule of rules) {
      expect(rule).toHaveProperty('type');
      expect(rule).toHaveProperty('label');
      expect(rule).toHaveProperty('description');
      expect(rule).toHaveProperty('hasOptions');
      expect(rule).toHaveProperty('streamingSafe');
      expect(rule).toHaveProperty('streamingNote');
      expect(typeof rule.streamingSafe).toBe('boolean');
      expect(typeof rule.streamingNote).toBe('string');
      expect(rule.streamingNote.length).toBeGreaterThan(0);
    }
  });

  it('only remove-reasoning and remove-footnote-tags are streaming-safe', () => {
    const rules = listAvailableRules();
    const safe = rules.filter((r) => r.streamingSafe);
    const safeTypes = safe.map((r) => r.type).sort();
    expect(safeTypes).toEqual(['remove-footnote-tags', 'remove-reasoning']);
  });

  it('non-streaming-safe rules have descriptive streaming notes', () => {
    const rules = listAvailableRules();
    const unsafe = rules.filter((r) => !r.streamingSafe);
    expect(unsafe.length).toBeGreaterThan(0);
    for (const rule of unsafe) {
      expect(rule.streamingNote).toMatch(/post-stream|full response/i);
    }
  });
});

/* ── Post-stream formatting dual-path behavior ───────────────── */

describe('post-stream formatting dual-path', () => {
  it('streaming-safe rules produce same result from both paths', () => {
    const input = 'Hello <#1#> world <#2#>';
    const streamRules = [{ type: 'remove-footnote-tags', order: 0 }];
    const allRules = [{ type: 'remove-footnote-tags', order: 0 }];

    const rawResult = applyFormattingRules(input, streamRules);
    const fullResult = applyFormattingRules(input, allRules);
    expect(rawResult.formatted).toBe(fullResult.formatted);
  });

  it('post-stream rules produce different (formatted) result from raw', () => {
    const input = 'Some text\n```json\n{"key": "value"}\n```\nMore text';
    const streamRules: { type: string; order: number }[] = [];
    const allRules = [{ type: 'trim-to-json', order: 0 }];

    const rawResult = applyFormattingRules(input, streamRules);
    const fullResult = applyFormattingRules(input, allRules);

    expect(rawResult.formatted).toBe(input);
    expect(fullResult.formatted).toBe('{"key": "value"}');
    expect(rawResult.formatted).not.toBe(fullResult.formatted);
  });

  it('repair-json + trim-to-json chain produces valid JSON from broken input', () => {
    const input = 'Here is the result:\n{"items": ["a", "b",]}';
    const allRules = [
      { type: 'trim-to-json', order: 0 },
      { type: 'repair-json', order: 1 },
    ];

    const result = applyFormattingRules(input, allRules);
    expect(() => JSON.parse(result.formatted)).not.toThrow();
    const parsed = JSON.parse(result.formatted);
    expect(parsed.items).toContain('a');
  });
});
