import { isAmountUnstated } from '@cadence/shared';
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

/**
 * The client used to default a missing `qty` to 1, which turned the API's honest "we were not
 * told how much" into a quantity the screen showed as if the person had given it.
 */
describe('recipes client parsers — an amount nobody stated', () => {
  const qtyOf = (raw: unknown) =>
    parseRecipeDraft({ name: 'X', servings: 1, ingredients: [{ name: 'onion', qty: raw }] })?.ingredients[0];

  const table: Array<[label: string, input: unknown, qty: number | string | null]> = [
    ['a number', 500, 500],
    ['a string amount', 'to taste', 'to taste'],
    ['an explicit null', null, null],
    ['a boolean', true, null],
  ];

  for (const [label, input, qty] of table) {
    it(`reads ${label} as ${JSON.stringify(qty)}`, () => {
      expect(qtyOf(input)?.qty).toEqual(qty);
    });
  }

  it('marks a row with no amount at all rather than inventing one', () => {
    const d = parseRecipeDraft({ name: 'X', servings: 1, ingredients: [{ name: 'onion' }] });
    expect(d?.ingredients[0]).toEqual({ name: 'onion', qty: null, amount_unstated: true });
    expect(isAmountUnstated(d!.ingredients[0]!)).toBe(true);
  });

  it('keeps the incomplete-total flag off the per-serving macros', () => {
    const d = parseRecipeDraft({
      name: 'X',
      servings: 1,
      ingredients: [{ name: 'onion', qty: null }],
      macros_per_serving: { kcal: 210, has_unstated_amounts: true },
    });
    expect(d?.macros_per_serving.has_unstated_amounts).toBe(true);
  });

  it('leaves a complete total unflagged', () => {
    const d = parseRecipeDraft({
      name: 'X',
      servings: 1,
      ingredients: [{ name: 'onion', qty: 1 }],
      macros_per_serving: { kcal: 210 },
    });
    expect(d?.macros_per_serving.has_unstated_amounts).toBeUndefined();
    expect(isAmountUnstated(d!.ingredients[0]!)).toBe(false);
  });
});
