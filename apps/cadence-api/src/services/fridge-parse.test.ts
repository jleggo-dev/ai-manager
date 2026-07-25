import { describe, expect, it } from 'vitest';
import {
  coerceFridgeIngredients,
  formatIngredientsForJob,
  parseFridgePhotoResult,
  parseGenerateRecipeResult,
} from './fridge-parse.ts';

describe('parseFridgePhotoResult', () => {
  it('parses a readable fridge list', () => {
    const shaped = parseFridgePhotoResult(
      JSON.stringify({
        ingredients: [
          { name: 'eggs', qty: 6, unit: 'item' },
          { name: 'spinach', qty: null, unit: null },
          { name: '  ', qty: 1 },
        ],
        summary: 'eggs, spinach',
        confidence: 0.82,
        photo_readable: true,
      }),
      'u/2026-07-25/x.jpg',
    );
    expect(shaped.photo_readable).toBe(true);
    expect(shaped.photo_ref).toBe('u/2026-07-25/x.jpg');
    expect(shaped.ingredients).toEqual([{ name: 'eggs', qty: 6, unit: 'item' }, { name: 'spinach' }]);
    expect(shaped.confidence).toBeCloseTo(0.82);
  });

  it('clears ingredients when photo is unreadable', () => {
    const shaped = parseFridgePhotoResult(
      JSON.stringify({
        ingredients: [{ name: 'guess' }],
        confidence: 0.9,
        photo_readable: false,
      }),
    );
    expect(shaped.ingredients).toEqual([]);
    expect(shaped.confidence).toBeLessThanOrEqual(0.3);
  });

  it('throws on non-JSON', () => {
    expect(() => parseFridgePhotoResult('NOT_JSON')).toThrow(/non-JSON/);
  });
});

describe('parseGenerateRecipeResult', () => {
  it('keeps up to three structured recipes and tags', () => {
    const bundle = parseGenerateRecipeResult(
      JSON.stringify({
        recipes: [
          {
            name: 'Spinach scramble',
            servings: 2,
            ingredients: [{ name: 'eggs', qty: 4, unit: 'item' }],
            steps: ['Whisk', 'Cook'],
            tags: ['quick', 'breakfast'],
          },
          {
            name: 'Bad',
            servings: 1,
            ingredients: [],
            steps: [],
          },
          {
            name: 'Cheddar rice bowl',
            servings: 1,
            ingredients: [
              { name: 'rice', qty: 1, unit: 'cup' },
              { name: 'cheddar', qty: 40, unit: 'g' },
            ],
            steps: ['Heat rice', 'Melt cheese'],
          },
        ],
        notes: 'Easy weeknight ideas.',
      }),
    );
    expect(bundle.recipes).toHaveLength(2);
    expect(bundle.recipes[0]?.name).toBe('Spinach scramble');
    expect(bundle.tags[0]).toEqual(['quick', 'breakfast']);
    expect(bundle.notes).toBe('Easy weeknight ideas.');
  });
});

describe('formatIngredientsForJob / coerceFridgeIngredients', () => {
  it('formats reviewed rows for the job variable', () => {
    expect(formatIngredientsForJob([{ name: 'eggs', qty: 6, unit: 'item' }, { name: 'spinach' }])).toBe(
      '6 item eggs; spinach',
    );
  });

  it('coerces untrusted arrays', () => {
    expect(
      coerceFridgeIngredients([{ name: ' eggs ', qty: 2 }, { name: '' }, null, { name: 'rice', unit: 'cup' }]),
    ).toEqual([
      { name: 'eggs', qty: 2 },
      { name: 'rice', unit: 'cup' },
    ]);
  });
});
