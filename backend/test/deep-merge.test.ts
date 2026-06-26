import { describe, it, expect } from 'vitest';

/**
 * Standalone copy of the deepMerge implementation from
 * src/models/processing-jobs.ts for unit testing.
 */
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function deepMerge(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...target };
  for (const key of Object.keys(source)) {
    if (DANGEROUS_KEYS.has(key)) continue;
    if (
      source[key] && typeof source[key] === 'object' && !Array.isArray(source[key]) &&
      target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])
    ) {
      result[key] = deepMerge(
        target[key] as Record<string, unknown>,
        source[key] as Record<string, unknown>,
      );
    } else {
      result[key] = source[key];
    }
  }
  return result;
}

describe('deepMerge', () => {
  it('merges flat objects', () => {
    const target = { a: 1, b: 2 };
    const source = { c: 3 };
    expect(deepMerge(target, source)).toEqual({ a: 1, b: 2, c: 3 });
  });

  it('overwrites primitives in target', () => {
    const target = { a: 1, b: 'old' };
    const source = { b: 'new' };
    expect(deepMerge(target, source)).toEqual({ a: 1, b: 'new' });
  });

  it('deep merges nested objects', () => {
    const target = { config: { theme: 'dark', lang: 'en' } };
    const source = { config: { theme: 'light' } };
    expect(deepMerge(target, source)).toEqual({
      config: { theme: 'light', lang: 'en' },
    });
  });

  it('arrays in source overwrite arrays in target (not merged)', () => {
    const target = { tags: ['a', 'b'] };
    const source = { tags: ['c'] };
    expect(deepMerge(target, source)).toEqual({ tags: ['c'] });
  });

  it('new keys from source are added', () => {
    const target = { existing: true };
    const source = { brand_new: 'yes' };
    expect(deepMerge(target, source)).toEqual({ existing: true, brand_new: 'yes' });
  });

  it('SECURITY: rejects __proto__ key', () => {
    const target = {};
    const source = JSON.parse('{"__proto__":{"polluted":true}}');
    const result = deepMerge(target, source);
    expect(result).not.toHaveProperty('__proto__.polluted');
    expect(Object.prototype).not.toHaveProperty('polluted');
  });

  it('SECURITY: rejects constructor key', () => {
    const target = {};
    const source = { constructor: { polluted: true } };
    const result = deepMerge(target, source);
    expect(result).not.toHaveProperty('constructor');
  });

  it('SECURITY: rejects prototype key', () => {
    const target = {};
    const source = { prototype: { polluted: true } };
    const result = deepMerge(target, source);
    expect(result).not.toHaveProperty('prototype');
  });

  it('handles null values in source', () => {
    const target = { a: 1, b: { nested: true } };
    const source = { b: null };
    const result = deepMerge(target, source as Record<string, unknown>);
    expect(result.b).toBeNull();
  });

  it('does not mutate original target object', () => {
    const target = { a: 1, nested: { x: 10 } };
    const source = { a: 2, nested: { y: 20 } };
    const original = JSON.parse(JSON.stringify(target));
    deepMerge(target, source);
    expect(target).toEqual(original);
  });
});
