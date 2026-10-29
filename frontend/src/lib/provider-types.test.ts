import { describe, expect, it } from 'vitest';
import { isModelOnlyProviderType, isSyncableProviderType, providerEnforcesSchema } from './provider-types';

describe('isModelOnlyProviderType', () => {
  it.each([
    ['google-gemini', true],
    ['devs-ai-v2', true],
    ['vercel-ai-gateway', true],
    ['devs-ai', false],
    ['vercel', false],
    ['', false],
  ])('%j → %s', (type, expected) => {
    expect(isModelOnlyProviderType(type)).toBe(expected);
  });
});

describe('isSyncableProviderType', () => {
  it.each([
    ['google-gemini', true],
    ['devs-ai', true],
    ['devs-ai-v2', true],
    ['vercel-ai-gateway', true],
    ['vercel-ai', false],
    ['', false],
  ])('%j → %s', (type, expected) => {
    expect(isSyncableProviderType(type)).toBe(expected);
  });
});

describe('providerEnforcesSchema', () => {
  it.each([
    ['devs-ai-v2', true],
    ['vercel-ai-gateway', true],
    ['devs-ai', false],
    ['google-gemini', false],
    [undefined, false],
    [null, false],
  ])('%j → %s', (type, expected) => {
    expect(providerEnforcesSchema(type)).toBe(expected);
  });
});
