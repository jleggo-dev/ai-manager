/**
 * MP24 — a one-tap "planned" / "usual" recipe row hands over only an id. This bridges that id to
 * the SAME confirm `RecipesPanel`'s "Log again" uses, so a quick-add tap never silently writes a
 * hardcoded amount the way `CookSheet`/`useMealCapture`/`useLogActions` used to.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const getRecipeById = vi.fn();
const logMealFromRecipe = vi.fn();

vi.mock('../../lib/api.ts', () => ({
  getRecipeById: (...a: unknown[]) => getRecipeById(...a),
  logMealFromRecipe: (...a: unknown[]) => logMealFromRecipe(...a),
  recipeMacroHint: () => '',
}));

vi.mock('../../lib/query/index.ts', () => ({
  useInvalidateNutritionDay: () => vi.fn(async () => undefined),
}));

const { RecipeQuickLog } = await import('./RecipeQuickLog.tsx');

const recipe = {
  recipe_id: 'r1',
  name: 'Beef chili',
  source: 'ai_from_chat' as const,
  servings: 6,
  ingredients: [],
  steps: [],
  macros_per_serving: { kcal: 320, protein_g: 28, carbs_g: 22, fat_g: 12 },
  tags: [],
  saved: true,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('RecipeQuickLog', () => {
  it('fetches the recipe by id, then opens the real confirm — not a hardcoded log', async () => {
    getRecipeById.mockResolvedValue({ status: 'ok', recipe });
    logMealFromRecipe.mockResolvedValue({ log_id: 'm1' });
    const onLogged = vi.fn();

    render(<RecipeQuickLog recipeId="r1" onCancel={() => {}} onLogged={onLogged} />);

    await waitFor(() => expect(screen.getByText(/Log Beef chili\?/i)).toBeInTheDocument());
    expect(getRecipeById).toHaveBeenCalledWith('r1');
    expect(logMealFromRecipe).not.toHaveBeenCalled();

    screen.getByRole('button', { name: /Looks right — log it/i }).click();
    await waitFor(() =>
      expect(logMealFromRecipe).toHaveBeenCalledWith(expect.objectContaining({ recipe_id: 'r1', servings: 1 })),
    );
    await waitFor(() => expect(onLogged).toHaveBeenCalledWith({ log_id: 'm1' }));
  });

  it('prefills the servings the caller already knew, rather than always defaulting to 1', async () => {
    getRecipeById.mockResolvedValue({ status: 'ok', recipe });

    render(<RecipeQuickLog recipeId="r1" initialServings={2} onCancel={() => {}} onLogged={() => {}} />);

    await waitFor(() => expect(screen.getByLabelText('Servings')).toHaveValue(2));
  });

  it('reports a warm error and offers a way back when the recipe cannot be opened', async () => {
    getRecipeById.mockResolvedValue({ status: 'error', recipe: null });
    const onCancel = vi.fn();

    render(<RecipeQuickLog recipeId="r1" onCancel={onCancel} onLogged={() => {}} />);

    await waitFor(() => expect(screen.getByText(/Couldn't open that recipe/i)).toBeInTheDocument());
    screen.getByRole('button', { name: /Back/i }).click();
    expect(onCancel).toHaveBeenCalled();
  });
});
