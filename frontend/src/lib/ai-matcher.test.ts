import { describe, it, expect } from 'vitest';
import {
  composeMatcherPrompt,
  emptySlot,
  fastestSuccessDuration,
  isSlotConfigured,
  toMatcherSlotPayload,
  validateSchema,
} from './ai-matcher';
import type { AiMatcherSlotResult, ExpectedSchema } from '../types/api';

describe('composeMatcherPrompt', () => {
  it('replaces placeholders via interpolateTemplate', () => {
    expect(composeMatcherPrompt('Hello {{name}}!', { name: 'Alice' })).toBe('Hello Alice!');
  });

  it('leaves missing keys intact', () => {
    expect(composeMatcherPrompt('{{a}} and {{b}}', { a: 'yes' })).toBe('yes and {{b}}');
  });

  it('avoids substring key collisions that naive replace can mishandle', () => {
    // Keys where one name is a prefix of another — regex/order bugs surface here.
    const text = composeMatcherPrompt('{{user}} / {{user_id}}', {
      user: 'alice',
      user_id: '42',
    });
    expect(text).toBe('alice / 42');
  });
});

describe('isSlotConfigured / toMatcherSlotPayload', () => {
  it('treats profile slots as configured only with a profileId', () => {
    const slot = emptySlot();
    expect(isSlotConfigured(slot)).toBe(false);
    slot.profileId = 'p1';
    expect(isSlotConfigured(slot)).toBe(true);
    expect(toMatcherSlotPayload(slot)).toEqual({ type: 'profile', profileId: 'p1' });
  });

  it('requires provider + external id for custom slots', () => {
    const slot = emptySlot();
    slot.source = 'custom';
    slot.providerId = 'prov-1';
    expect(isSlotConfigured(slot)).toBe(false);
    slot.externalAiId = 'model-1';
    expect(isSlotConfigured(slot)).toBe(true);
    expect(toMatcherSlotPayload(slot)).toMatchObject({
      type: 'adhoc',
      providerId: 'prov-1',
      externalAiId: 'model-1',
      mode: 'completion',
    });
  });
});

describe('validateSchema', () => {
  const schema: ExpectedSchema = {
    fields: {
      title: { type: 'string', required: true },
      tags: { type: 'array', required: false },
    },
  };

  it('returns null when schema has no fields', () => {
    expect(validateSchema('{}', { fields: {} })).toBeNull();
  });

  it('reports parse errors for invalid JSON', () => {
    const result = validateSchema('not-json', schema);
    expect(result?.parseError).toMatch(/Invalid JSON/);
    expect(result?.valid).toBe(false);
  });

  it('counts required missing fields as errors', () => {
    const result = validateSchema(JSON.stringify({ tags: ['a'] }), schema);
    expect(result?.summary).toEqual({ total: 2, passed: 1, errors: 1 });
    expect(result?.valid).toBe(false);
  });

  it('passes when required fields are present', () => {
    const result = validateSchema(JSON.stringify({ title: 'Hello', tags: [] }), schema);
    // empty array counts as empty → tags optional so still valid
    expect(result?.summary.passed).toBe(1);
    expect(result?.summary.errors).toBe(0);
    expect(result?.valid).toBe(true);
  });
});

describe('fastestSuccessDuration', () => {
  it('returns null when there are no successful results', () => {
    expect(fastestSuccessDuration([null])).toBeNull();
  });

  it('returns the minimum successful duration', () => {
    const results: (AiMatcherSlotResult | null)[] = [
      {
        slotIndex: 0,
        status: 'success',
        raw: 'a',
        formatted: 'a',
        formattingSteps: null,
        durationMs: 120,
        model: 'm',
        provider: 'p',
        profileName: null,
        usage: null,
        finishReason: null,
      },
      {
        slotIndex: 1,
        status: 'success',
        raw: 'b',
        formatted: 'b',
        formattingSteps: null,
        durationMs: 40,
        model: 'm',
        provider: 'p',
        profileName: null,
        usage: null,
        finishReason: null,
      },
    ];
    expect(fastestSuccessDuration(results)).toBe(40);
  });
});
