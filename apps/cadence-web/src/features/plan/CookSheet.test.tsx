/**
 * MP24 — `CookSheet` was the worst of the three one-tap surfaces: it logged `servings:
 * recipe.servings`, the recipe's whole BATCH size, so cooking a 4-serving dish for the family
 * landed as 4 servings in the one person's day who tapped "Log". These pin that the final step now
 * opens the same portion-aware `RecipeLogConfirm` the recipe surfaces share, defaulting to ONE serving rather than
 * the batch, and that the no-recipe fallback still just marks the task done.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const getOccurrenceDetail = vi.fn();
const getCurrentMealPlan = vi.fn();
const getRecipeById = vi.fn();
const logMealFromRecipe = vi.fn();
const setOccurrence = vi.fn();

vi.mock('../../lib/api.ts', () => ({
  getOccurrenceDetail: (...a: unknown[]) => getOccurrenceDetail(...a),
  getCurrentMealPlan: (...a: unknown[]) => getCurrentMealPlan(...a),
  getRecipeById: (...a: unknown[]) => getRecipeById(...a),
  logMealFromRecipe: (...a: unknown[]) => logMealFromRecipe(...a),
  setOccurrence: (...a: unknown[]) => setOccurrence(...a),
  recipeMacroHint: () => '',
}));

vi.mock('../../lib/query/index.ts', () => ({
  useInvalidateNutritionDay: () => vi.fn(async () => undefined),
}));

const { CookSheet } = await import('./CookSheet.tsx');

const detail = {
  occurrence_id: 'occ1',
  activity_id: 'a1',
  date: '2026-08-26',
  status: 'pending' as const,
  title: 'Cook pork chops with mushroom sauce',
  kind: 'user' as const,
};

const familyRecipe = {
  recipe_id: 'r1',
  name: 'Pork chops with mushroom sauce',
  source: 'user' as const,
  servings: 4,
  ingredients: [],
  steps: [],
  macros_per_serving: { kcal: 480, protein_g: 38, carbs_g: 12, fat_g: 30 },
  tags: [],
  saved: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  getOccurrenceDetail.mockResolvedValue(detail);
});

describe('CookSheet', () => {
  it('opens the portion confirm instead of logging the recipe’s whole batch', async () => {
    getCurrentMealPlan.mockResolvedValue({
      status: 'ok',
      plan: { days: [{ day: '2026-08-26', meals: [{ slot: 'dinner', recipe_id: 'r1' }] }] },
    });
    getRecipeById.mockResolvedValue({ status: 'ok', recipe: familyRecipe });

    render(<CookSheet occurrenceId="occ1" onClose={() => {}} />);

    const logBtn = await screen.findByRole('button', { name: /Log Pork chops with mushroom sauce/i });
    expect(logMealFromRecipe).not.toHaveBeenCalled();
    logBtn.click();

    // The confirm, not a silent write of the 4-serving batch.
    await waitFor(() => expect(screen.getByText(/Log Pork chops with mushroom sauce\?/i)).toBeInTheDocument());
    expect(screen.getByLabelText('Servings')).toHaveValue(1);
    expect(logMealFromRecipe).not.toHaveBeenCalled();

    screen.getByRole('button', { name: /Looks right — log it/i }).click();
    await waitFor(() =>
      expect(logMealFromRecipe).toHaveBeenCalledWith(expect.objectContaining({ recipe_id: 'r1', servings: 1 })),
    );
  });

  it('ticks the task once the confirm logs', async () => {
    getCurrentMealPlan.mockResolvedValue({
      status: 'ok',
      plan: { days: [{ day: '2026-08-26', meals: [{ slot: 'dinner', recipe_id: 'r1' }] }] },
    });
    getRecipeById.mockResolvedValue({ status: 'ok', recipe: familyRecipe });
    logMealFromRecipe.mockResolvedValue({ log_id: 'm1' });
    const onLogged = vi.fn();
    const onClose = vi.fn();

    render(<CookSheet occurrenceId="occ1" onClose={onClose} onLogged={onLogged} />);

    (await screen.findByRole('button', { name: /Log Pork chops/i })).click();
    await waitFor(() => screen.getByRole('button', { name: /Looks right — log it/i }));
    screen.getByRole('button', { name: /Looks right — log it/i }).click();

    await waitFor(() => expect(onLogged).toHaveBeenCalled());
    expect(onClose).toHaveBeenCalled();
  });

  it('degrades to a plain "mark it cooked" when no recipe resolves — never logs a guess', async () => {
    getCurrentMealPlan.mockResolvedValue({ status: 'ok', plan: { days: [] } });
    setOccurrence.mockResolvedValue(undefined);
    const onClose = vi.fn();

    render(<CookSheet occurrenceId="occ1" onClose={onClose} />);

    const btn = await screen.findByRole('button', { name: /Mark it cooked/i });
    btn.click();

    await waitFor(() => expect(setOccurrence).toHaveBeenCalledWith('occ1', 'done'));
    expect(logMealFromRecipe).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });
});
