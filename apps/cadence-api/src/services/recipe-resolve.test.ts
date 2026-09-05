/**
 * Req 5 WS3 — recipe ingredient resolution, orchestration only (MP9's own layer).
 *
 * Every collaborator is mocked, so this runs with no DB and no AI seam — unlike recipe.test.ts
 * (real Postgres + mocked AI, which proves END-TO-END outcomes like "3 shallots prices to 54
 * kcal"), this file proves the exact CALL SHAPE: how many times each collaborator ran and with
 * what arguments. That precision is what MP9 (shared context loaded once, not once per ingredient)
 * and MP8 (the pin call sequence) need and a DB-outcome test cannot show on its own.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Food } from '@cadence/shared';
import type { FoodCandidate } from './food-capture-parse.ts';
import type { ResolveShared } from './food-resolver.ts';
import type { StructuredRecipe } from './recipe-parse.ts';

vi.mock('../repos/users.ts', () => ({ getDietaryProfile: vi.fn(async () => null) }));
vi.mock('../repos/foods.ts', () => ({ getFood: vi.fn(), insertFood: vi.fn() }));
vi.mock('./food-pricing.ts', () => ({ findOwnDuplicate: vi.fn(async () => null) }));
vi.mock('./food-resolver.ts', () => ({ loadResolveShared: vi.fn(), resolveFoods: vi.fn() }));
vi.mock('./food-capture.ts', () => ({ estimateFood: vi.fn() }));

const { getFood, insertFood } = await import('../repos/foods.ts');
const { findOwnDuplicate } = await import('./food-pricing.ts');
const { loadResolveShared, resolveFoods } = await import('./food-resolver.ts');
const { estimateFood } = await import('./food-capture.ts');
const { buildDraftFromStructured } = await import('./recipe.ts');

const USER = 'user-1';

const SHARED: ResolveShared = {
  ctx: { userId: USER } as ResolveShared['ctx'],
  recents: [],
  frequents: [],
  profile: null,
};

function threeIngredientRecipe(): StructuredRecipe {
  return {
    name: 'Test recipe',
    servings: 2,
    ingredients: [
      { name: 'ingredient a', qty: 1 },
      { name: 'ingredient b', qty: 2 },
      { name: 'ingredient c', qty: 3 },
    ],
    steps: [],
  };
}

describe('buildDraftFromStructured — resolution orchestration', () => {
  beforeEach(() => {
    vi.mocked(loadResolveShared).mockReset().mockResolvedValue(SHARED);
    vi.mocked(resolveFoods).mockReset().mockResolvedValue({ candidates: [], preselected: null });
    vi.mocked(getFood).mockReset();
    vi.mocked(insertFood).mockReset();
    vi.mocked(findOwnDuplicate).mockReset().mockResolvedValue(null);
    vi.mocked(estimateFood).mockReset().mockRejectedValue(new Error('no estimate configured for this test'));
  });

  /**
   * MP9 — fail-first shape: before this fix, `resolveOneIngredient` called
   * `resolveFoods(userId, { text })` with no third argument, so `resolveFoods` (which loads its
   * own `loadResolveShared` whenever nobody hands it one) re-ran the four per-user ranking queries
   * once per ingredient. Asserting `loadResolveShared` ran exactly once — REGARDLESS of ingredient
   * count — and that every `resolveFoods` call received the exact same shared reference is the
   * precise claim MP9 makes; a passing outcome test could not distinguish "shared once" from
   * "coincidentally correct four times".
   */
  it('loads the shared per-user ranking context once for the whole recipe, not once per ingredient', async () => {
    await buildDraftFromStructured(USER, threeIngredientRecipe(), 'ai_from_chat');

    expect(loadResolveShared).toHaveBeenCalledTimes(1);
    expect(loadResolveShared).toHaveBeenCalledWith(USER);
    expect(resolveFoods).toHaveBeenCalledTimes(3);
    for (const call of vi.mocked(resolveFoods).mock.calls) {
      expect(call[2]).toBe(SHARED); // reference equality — the SAME load, not a fresh one
    }
  });

  it('still resolves all N ingredients even though shared is loaded once', async () => {
    const draft = await buildDraftFromStructured(USER, threeIngredientRecipe(), 'ai_from_chat');
    expect(draft.ingredients).toHaveLength(3);
  });

  /**
   * MP8 — the exact pin sequence: search misses (no candidates), estimate_food succeeds,
   * `findOwnDuplicate` is checked BEFORE minting a new row, and — since nothing to reuse exists —
   * `insertFood` is called with the estimate's own shape (name/brand/source/base_unit/
   * macros_per_base/servings/default_serving/confidence), never a second, hand-rolled dedup check.
   */
  it('pins an unheld ingredient with the estimate’s own shape when nothing to reuse exists', async () => {
    const candidate: FoodCandidate = {
      name: 'Chopped Tarragon',
      brand: null,
      source: 'llm',
      base_unit: 'g',
      macros_per_base: { kcal: 5, protein_g: 0.4 },
      servings: [{ label: '1 tbsp', unit: 'tbsp', amount_g: 3.3 }],
      default_serving: 0,
      confidence: 0.6,
      photo_ref: null,
    };
    vi.mocked(estimateFood).mockResolvedValue(candidate);
    const pinned: Food = {
      food_id: 'new-food-1',
      owner_user_id: USER,
      visibility: 'private',
      name: candidate.name,
      brand: candidate.brand,
      source: candidate.source,
      off_id: null,
      fdc_id: null,
      base_unit: candidate.base_unit,
      macros_per_base: candidate.macros_per_base,
      servings: candidate.servings,
      default_serving: candidate.default_serving,
      confidence: candidate.confidence,
      photo_ref: null,
    };
    vi.mocked(insertFood).mockResolvedValue(pinned);

    const structured: StructuredRecipe = {
      name: 'Sauce',
      servings: 1,
      ingredients: [{ name: 'tarragon', qty: 1, unit: 'tbsp' }],
      steps: [],
    };
    const draft = await buildDraftFromStructured(USER, structured, 'ai_from_chat');

    expect(findOwnDuplicate).toHaveBeenCalledWith(USER, 'Chopped Tarragon', null);
    expect(insertFood).toHaveBeenCalledWith(
      USER,
      expect.objectContaining({
        name: 'Chopped Tarragon',
        visibility: 'private',
        source: 'llm',
        base_unit: 'g',
      }),
    );
    // findOwnDuplicate must be checked BEFORE insertFood commits to a new row.
    const dedupOrder = vi.mocked(findOwnDuplicate).mock.invocationCallOrder[0]!;
    const insertOrder = vi.mocked(insertFood).mock.invocationCallOrder[0]!;
    expect(dedupOrder).toBeLessThan(insertOrder);

    expect(draft.ingredients[0]?.food_id).toBe('new-food-1');
    expect(draft.ingredients[0]?.estimated).toBe(true);
  });

  /** MP8 dedup: when a reusable food already exists, `insertFood` must never be called. */
  it('reuses a duplicate found by findOwnDuplicate instead of inserting a new row', async () => {
    const candidate: FoodCandidate = {
      name: 'Green Onions',
      brand: null,
      source: 'llm',
      base_unit: 'g',
      macros_per_base: { kcal: 32 },
      servings: [{ label: '100 g', unit: 'g', amount_g: 100 }],
      default_serving: 0,
      confidence: 0.5,
      photo_ref: null,
    };
    vi.mocked(estimateFood).mockResolvedValue(candidate);
    const existing: Food = {
      food_id: 'existing-food-1',
      owner_user_id: USER,
      visibility: 'private',
      name: 'Green Onions',
      brand: null,
      source: 'llm',
      off_id: null,
      fdc_id: null,
      base_unit: 'g',
      macros_per_base: { kcal: 32 },
      servings: [{ label: '100 g', unit: 'g', amount_g: 100 }],
      default_serving: 0,
      confidence: 0.6,
      photo_ref: null,
    };
    vi.mocked(findOwnDuplicate).mockResolvedValue(existing);

    const structured: StructuredRecipe = {
      name: 'Sauce',
      servings: 1,
      ingredients: [{ name: 'green onion thing', qty: 2 }],
      steps: [],
    };
    const draft = await buildDraftFromStructured(USER, structured, 'ai_from_chat');

    expect(insertFood).not.toHaveBeenCalled();
    expect(draft.ingredients[0]?.food_id).toBe('existing-food-1');
  });

  /**
   * MP10 — neither a match nor an estimate: the ingredient must say so explicitly rather than
   * carrying `estimated: true` with no numbers behind it (the pre-MP10 shape).
   */
  it('an ingredient nothing can resolve or estimate reports unresolved with a reason, never a bare estimated flag', async () => {
    const structured: StructuredRecipe = {
      name: 'Sauce',
      servings: 1,
      ingredients: [{ name: 'a truly unknowable thing', qty: 1 }],
      steps: [],
    };
    const draft = await buildDraftFromStructured(USER, structured, 'ai_from_chat');
    const ing = draft.ingredients[0];
    expect(ing?.est).toBeUndefined();
    expect(ing?.estimated).toBeUndefined();
    expect(ing?.unresolved).toBe(true);
    expect(ing?.reason).toBeTruthy();
  });
});

/**
 * An unstated amount ("some onion"): the food is real, the amount is not known, and the draft has
 * to say so instead of pricing a number nobody gave. What these pin:
 *   • the line is NOT priced — no `est`, and the per-serving total excludes it entirely;
 *   • the total says it is incomplete (`has_unstated_amounts`), so it reads as missing something
 *     rather than as a small dish;
 *   • `qty` stays null — not 0, not 1;
 *   • estimate_food is never called, because there is no amount to estimate against;
 *   • the food is still identified, so filling the amount in prices straight off the ledger.
 */
describe('buildDraftFromStructured — an amount nobody stated', () => {
  const FOOD: Food = {
    food_id: 'food-onion',
    owner_user_id: USER,
    visibility: 'private',
    name: 'Onion, raw',
    brand: null,
    source: 'llm',
    off_id: null,
    fdc_id: null,
    base_unit: 'g',
    macros_per_base: { kcal: 40 },
    servings: [{ label: '100 g', unit: 'g', amount_g: 100 }],
    default_serving: 0,
    confidence: 0.7,
    photo_ref: null,
  };

  /** One priced ingredient plus one whose amount was never given. */
  function mixedRecipe(): StructuredRecipe {
    return {
      name: 'Beef chili',
      servings: 2,
      ingredients: [
        { name: 'ground beef', qty: 500, unit: 'g' },
        { name: 'onion', qty: null, unit: 'item' },
      ],
      steps: [],
    };
  }

  beforeEach(() => {
    vi.mocked(loadResolveShared).mockReset().mockResolvedValue(SHARED);
    vi.mocked(resolveFoods).mockReset().mockResolvedValue({ candidates: [], preselected: null });
    vi.mocked(getFood).mockReset().mockResolvedValue(FOOD);
    vi.mocked(insertFood).mockReset();
    vi.mocked(findOwnDuplicate).mockReset().mockResolvedValue(null);
    vi.mocked(estimateFood).mockReset().mockRejectedValue(new Error('estimate must not run for an unstated amount'));
  });

  it('keeps the ingredient, prices nothing for it, and leaves qty null', async () => {
    vi.mocked(resolveFoods).mockResolvedValue({
      candidates: [{ kind: 'food', food_id: FOOD.food_id }],
      preselected: null,
    } as unknown as Awaited<ReturnType<typeof resolveFoods>>);

    const structured: StructuredRecipe = {
      name: 'Chili',
      servings: 2,
      ingredients: [{ name: 'onion', qty: null, unit: 'item' }],
      steps: [],
    };
    const draft = await buildDraftFromStructured(USER, structured, 'ai_from_chat');
    const ing = draft.ingredients[0];

    expect(ing?.qty).toBeNull();
    expect(ing?.amount_unstated).toBe(true);
    expect(ing?.est).toBeUndefined();
    expect(ing?.estimated).toBeUndefined();
    // Identified anyway, so filling the amount in later is a straight price off the ledger.
    expect(ing?.food_id).toBe(FOOD.food_id);
    expect(estimateFood).not.toHaveBeenCalled();
  });

  it('marks the per-serving total incomplete rather than quietly counting the line as zero', async () => {
    const draft = await buildDraftFromStructured(USER, mixedRecipe(), 'ai_from_chat');
    expect(draft.macros_per_serving.has_unstated_amounts).toBe(true);
  });

  it('leaves a total with every amount stated unflagged', async () => {
    const structured: StructuredRecipe = {
      name: 'Chili',
      servings: 2,
      ingredients: [{ name: 'ground beef', qty: 500, unit: 'g' }],
      steps: [],
    };
    const draft = await buildDraftFromStructured(USER, structured, 'ai_from_chat');
    expect(draft.macros_per_serving.has_unstated_amounts).toBeUndefined();
  });

  it('still reports the ingredient even when nothing on file matches it', async () => {
    const structured: StructuredRecipe = {
      name: 'Chili',
      servings: 2,
      ingredients: [{ name: 'a thing nobody holds', qty: null }],
      steps: [],
    };
    const draft = await buildDraftFromStructured(USER, structured, 'ai_from_chat');
    expect(draft.ingredients[0]).toEqual({ name: 'a thing nobody holds', qty: null, amount_unstated: true });
  });
});
