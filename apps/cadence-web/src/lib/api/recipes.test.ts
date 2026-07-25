import { parseRecipe, parseRecipeDraft, recipeMacroHint } from './recipes.ts';

describe('recipes client parsers', () => {
  it('parses a full recipe with id aliases', () => {
    const r = parseRecipe({
      id: 'r1',
      name: 'Beef chili',
      source: 'ai_from_chat',
      servings: 6,
      ingredients: [{ name: 'beef', qty: 500, unit: 'g', food_id: 'f1' }],
      steps: ['Simmer'],
      macros_per_serving: { kcal: 320, protein_g: 28 },
      tags: ['batch'],
      saved: true,
    });
    expect(r).toMatchObject({
      recipe_id: 'r1',
      name: 'Beef chili',
      source: 'ai_from_chat',
      servings: 6,
      saved: true,
    });
    expect(r?.ingredients[0]?.food_id).toBe('f1');
  });

  it('parses a from-chat draft without recipe_id', () => {
    const d = parseRecipeDraft({
      name: 'Overnight oats',
      servings: 2,
      ingredients: [{ name: 'oats', qty: 80, unit: 'g' }],
      macros_per_serving: { kcal: 210 },
    });
    expect(d).toMatchObject({ name: 'Overnight oats', servings: 2, source: 'ai_from_chat' });
    expect(d?.recipe_id).toBeUndefined();
  });

  it('rejects empty names', () => {
    expect(parseRecipe({ recipe_id: 'x', name: '  ' })).toBeNull();
    expect(parseRecipeDraft({ name: '' })).toBeNull();
  });

  it('formats macro hints without shame', () => {
    expect(recipeMacroHint({ kcal: 320.4, protein_g: 28.2 })).toBe('~320 kcal · P28');
  });
});
