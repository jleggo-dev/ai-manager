/**
 * A draft may not know an amount; a saved recipe may not.
 *
 * `structure-recipe` now answers `qty: null` when the person never said how much ("some onion")
 * instead of picking a plausible number. That is fine while the recipe is an unsaved draft — the
 * amount is a question on the screen. It is NOT fine once saved: the row would keep a null amount
 * for ever, its per-serving macros would be a permanent floor, and nothing on the stored recipe
 * says why. So the confirm path refuses, and it refuses by NAMING the ingredient — an error that
 * only says "invalid ingredient" leaves the person hunting for which line to fill in.
 *
 * Every collaborator is mocked: the guard runs before any query, and that is exactly the claim —
 * a save with an unstated amount never reaches the database at all.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RecipeIngredient } from '../repos/recipes.ts';

vi.mock('../repos/users.ts', () => ({ getDietaryProfile: vi.fn(async () => null) }));
vi.mock('../repos/foods.ts', () => ({ getFood: vi.fn(async () => null), insertFood: vi.fn() }));
vi.mock('../repos/recipes.ts', () => ({
  insertRecipe: vi.fn(),
  updateRecipe: vi.fn(),
  getRecipe: vi.fn(),
  deleteRecipe: vi.fn(),
  listRecipes: vi.fn(),
  searchRecipes: vi.fn(),
}));

const { insertRecipe, updateRecipe, getRecipe } = await import('../repos/recipes.ts');
const { createRecipe, patchRecipe } = await import('./recipe.ts');
const { BodyValidationError } = await import('../validation/body.ts');

const USER = 'user-1';

function saveWith(ingredients: RecipeIngredient[]) {
  return createRecipe(USER, { name: 'Beef chili', servings: 2, ingredients });
}

beforeEach(() => {
  vi.mocked(insertRecipe).mockReset();
  vi.mocked(updateRecipe).mockReset();
  vi.mocked(getRecipe).mockReset();
});

describe('createRecipe — an amount nobody stated blocks the save', () => {
  const rejected: Array<[label: string, ingredient: RecipeIngredient]> = [
    ['a null amount', { name: 'onion', qty: null }],
    ['the draft flag on its own', { name: 'onion', qty: 1, amount_unstated: true }],
    ['an absent amount', { name: 'onion' } as unknown as RecipeIngredient],
  ];

  for (const [label, ingredient] of rejected) {
    it(`refuses ${label} and names the ingredient`, async () => {
      await expect(saveWith([{ name: 'ground beef', qty: 500, unit: 'g' }, ingredient])).rejects.toThrow(
        /I need an amount for onion before I can save this\./,
      );
      expect(insertRecipe).not.toHaveBeenCalled();
    });
  }

  it('names every ingredient still missing an amount, not just the first', async () => {
    await expect(
      saveWith([
        { name: 'onion', qty: null },
        { name: 'ground beef', qty: 500, unit: 'g' },
        { name: 'garlic', qty: null },
      ]),
    ).rejects.toThrow(/onion, garlic/);
  });

  it('rejects as a 400-shaped validation error, not a 500', async () => {
    await expect(saveWith([{ name: 'onion', qty: null }])).rejects.toBeInstanceOf(BodyValidationError);
  });

  /** A string amount ("to taste") is an amount someone chose to write — it was never the target. */
  it('lets a stated amount through, string amounts included', async () => {
    vi.mocked(insertRecipe).mockResolvedValue({
      recipe_id: 'r1',
      name: 'Beef chili',
      source: 'user',
      servings: 2,
      ingredients: [],
      steps: [],
      macros_per_serving: {},
      tags: [],
      saved: true,
    });
    await saveWith([
      { name: 'ground beef', qty: 500, unit: 'g' },
      { name: 'salt', qty: 'to taste' },
    ]);
    expect(insertRecipe).toHaveBeenCalledTimes(1);
  });
});

describe('patchRecipe — the same guard on the edit path', () => {
  it('refuses to blank out an amount on a saved recipe', async () => {
    await expect(patchRecipe(USER, 'r1', { ingredients: [{ name: 'onion', qty: null }] })).rejects.toThrow(
      /I need an amount for onion/,
    );
    expect(getRecipe).not.toHaveBeenCalled();
    expect(updateRecipe).not.toHaveBeenCalled();
  });
});
