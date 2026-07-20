import { describe, it, expect } from 'vitest';
import { BodyValidationError, parseBody, logMealBodySchema, macroTargetsBodySchema } from './body.ts';

describe('parseBody / nutrition schemas', () => {
  it('rejects empty meal bodies', () => {
    expect(() => parseBody(logMealBodySchema, {})).toThrow(BodyValidationError);
    expect(() => parseBody(logMealBodySchema, { text: '  ' })).toThrow(/words or a photo/);
  });

  it('accepts text and optional meal kind', () => {
    expect(parseBody(logMealBodySchema, { text: ' oatmeal ', meal: 'breakfast' })).toEqual({
      text: 'oatmeal',
      meal: 'breakfast',
      photo: undefined,
    });
  });

  it('rejects non-image photo strings', () => {
    expect(() => parseBody(logMealBodySchema, { photo: 'http://x' })).toThrow(/data:image/);
  });

  it('accepts macro target numbers (passthrough for service-side sanitize)', () => {
    expect(parseBody(macroTargetsBodySchema, { kcal: 2200, protein_g: 110 })).toMatchObject({
      kcal: 2200,
      protein_g: 110,
    });
  });
});
