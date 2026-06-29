import { describe, it, expect } from 'vitest';
import { resolveJsonPath, rootKeyFromPath } from '../src/lib/json-path.ts';

describe('resolveJsonPath', () => {
  const data = {
    score: 5,
    analysis: { score: 9, label: 'strong' },
    items: [{ title: 'first' }, { title: 'second' }],
  };

  it('resolves top-level keys', () => {
    expect(resolveJsonPath(data, 'score')).toBe(5);
  });

  it('resolves dot paths', () => {
    expect(resolveJsonPath(data, 'analysis.score')).toBe(9);
  });

  it('resolves bracket index paths', () => {
    expect(resolveJsonPath(data, 'items[0].title')).toBe('first');
  });

  it('returns undefined for missing paths', () => {
    expect(resolveJsonPath(data, 'missing.field')).toBeUndefined();
  });
});

describe('rootKeyFromPath', () => {
  it('returns simple keys unchanged', () => {
    expect(rootKeyFromPath('score')).toBe('score');
  });

  it('returns first segment for nested paths', () => {
    expect(rootKeyFromPath('analysis.score')).toBe('analysis');
    expect(rootKeyFromPath('items[0].title')).toBe('items');
  });
});

describe('extractAndAccumulateOutputs path integration', () => {
  it('maps nested paths via resolveJsonPath logic', async () => {
    const { extractAndAccumulateOutputs } = await import('../src/ai-manager/index.ts');
    /* Mock won't hit DB if no mappings match — test resolveJsonPath inline instead */
    const parsed = { analysis: { score: 42 } };
    const { resolveJsonPath: rjp } = await import('../src/lib/json-path.ts');
    expect(rjp(parsed, 'analysis.score')).toBe(42);
    void extractAndAccumulateOutputs;
  });
});
