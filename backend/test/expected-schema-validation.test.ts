import { describe, it, expect } from 'vitest';
import {
  expectedSchemaPasses,
  validateAgainstExpectedSchema,
} from '../src/services/expected-schema-validation.ts';

describe('expected-schema-validation', () => {
  const schema = {
    fields: {
      name: { type: 'string', required: true },
      score: { type: 'number', required: false },
    },
  };

  it('passes when required fields are present with correct types', () => {
    expect(expectedSchemaPasses('{"name":"Acme","score":42}', schema)).toBe(true);
  });

  it('fails when required field is missing', () => {
    const result = validateAgainstExpectedSchema('{"score":1}', schema);
    expect(result.jsonValid).toBe(true);
    expect(expectedSchemaPasses('{"score":1}', schema)).toBe(false);
    expect(result.errors.some((e) => e.includes('name'))).toBe(true);
  });

  it('fails on invalid JSON', () => {
    const result = validateAgainstExpectedSchema('not json', schema);
    expect(result.jsonValid).toBe(false);
    expect(result.errors[0]).toContain('valid JSON');
  });
});
