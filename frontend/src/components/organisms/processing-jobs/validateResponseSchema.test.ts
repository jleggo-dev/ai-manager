import { describe, expect, it } from 'vitest';
import { validateResponseSchema } from './validateResponseSchema';

describe('validateResponseSchema', () => {
  it('reports parse errors for invalid JSON', () => {
    const result = validateResponseSchema('{bad', null);
    expect(result.parseError).toMatch(/Invalid JSON/);
    expect(result.valid).toBe(false);
  });

  it('validates against a job expectedSchema', () => {
    const result = validateResponseSchema(JSON.stringify({ name: 'Acme', size: 'Small' }), {
      fields: {
        name: { type: 'string', required: true, description: 'Company Name' },
        size: {
          type: 'string',
          required: false,
          description: 'Size',
          allowedValues: ['Small', 'Medium'],
        },
      },
    });
    expect(result.parseError).toBeNull();
    expect(result.valid).toBe(true);
    expect(result.summary.passed).toBe(2);
  });

  it('flags disallowed enum values as errors', () => {
    const result = validateResponseSchema(JSON.stringify({ name: 'Acme', size: 'Huge' }), {
      fields: {
        name: { type: 'string', required: true, description: 'Company Name' },
        size: {
          type: 'string',
          required: false,
          description: 'Size',
          allowedValues: ['Small', 'Medium'],
        },
      },
    });
    expect(result.valid).toBe(false);
    expect(result.summary.errors).toBeGreaterThan(0);
  });
});
