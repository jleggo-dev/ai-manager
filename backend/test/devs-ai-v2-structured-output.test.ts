import { describe, it, expect } from 'vitest';
import { expectedSchemaFieldsToJsonSchema } from '../src/services/expected-schema-to-json-schema.ts';

describe('expectedSchemaFieldsToJsonSchema', () => {
  it('returns null when no fields', () => {
    expect(expectedSchemaFieldsToJsonSchema(null)).toBeNull();
    expect(expectedSchemaFieldsToJsonSchema({ fields: {} })).toBeNull();
  });

  it('converts fields to strict json_schema format', () => {
    const result = expectedSchemaFieldsToJsonSchema({
      fields: {
        title: { type: 'string', description: 'Headline', required: true },
        score: { type: 'number' },
      },
    });

    expect(result).not.toBeNull();
    expect(result?.format.type).toBe('json_schema');
    expect(result?.format.strict).toBe(true);
    expect(result?.format.schema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      required: ['title', 'score'],
      properties: {
        title: { type: 'string', description: 'Headline' },
        score: { type: 'number' },
      },
    });
  });

  it('maps allowedValues to enum', () => {
    const result = expectedSchemaFieldsToJsonSchema({
      fields: {
        status: { type: 'string', allowedValues: ['ok', 'fail'] },
      },
    });
    expect(result?.format.schema).toMatchObject({
      properties: { status: { type: 'string', enum: ['ok', 'fail'] } },
    });
  });
});
