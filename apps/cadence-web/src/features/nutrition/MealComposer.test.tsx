/**
 * Frame 10a, asserted on screen.
 *
 * The Kitchen's first version could only drop one saved recipe on a slot, and the design is
 * explicit that a meal is *"recipes, food, or both"* — a main, a side, and the oil it was cooked
 * in. These pin the three things that make that worth having: several items add up, the total says
 * how many it could actually count, and what gets saved is a meal rather than a log entry.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Recipe } from '@cadence/shared';

const api = { searchFoods: vi.fn(), getFoodById: vi.fn() };
vi.mock('../../lib/api.ts', () => ({
  searchFoods: (...a: unknown[]) => api.searchFoods(...a),
  getFoodById: (...a: unknown[]) => api.getFoodById(...a),
}));

const { MealComposer } = await import('./MealComposer.tsx');

const RECIPES = [
  {
    recipe_id: 'r1',
    name: 'Chicken thighs & lemon orzo',
    servings: 4,
    macros_per_serving: { kcal: 520, protein_g: 40, carbs_g: 45, fat_g: 18 },
  },
] as unknown as Recipe[];

const WEEK = ['2026-09-01', '2026-09-02', '2026-09-03'];

beforeEach(() => {
  vi.clearAllMocks();
  api.searchFoods.mockResolvedValue({ status: 'ok', foods: [{ food_id: 'f1', name: 'Olive oil' }] });
  api.getFoodById.mockResolvedValue({
    status: 'ok',
    food: {
      food_id: 'f1',
      name: 'Olive oil',
      base_unit: 'g',
      macros_per_base: { kcal: 884, protein_g: 0, carbs_g: 0, fat_g: 100 },
      servings: [{ label: '1 tbsp', unit: 'tbsp', amount_g: 13.5 }],
      default_serving: 0,
    },
  });
});

const setup = () => {
  const onSave = vi.fn();
  render(
    <MealComposer
      recipes={RECIPES}
      weekDays={WEEK}
      initialDay="2026-09-03"
      initialSlot="dinner"
      onSave={onSave}
      onCancel={() => {}}
    />,
  );
  return { onSave, user: userEvent.setup() };
};

describe('MealComposer', () => {
  it('will not save an empty meal — it says what is missing instead', () => {
    setup();
    expect(screen.getByRole('button', { name: /Add something first/i })).toBeDisabled();
  });

  it('adds a recipe and totals it', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: /Add a recipe/i }));
    await user.click(screen.getByRole('button', { name: /Chicken thighs/i }));

    expect(await screen.findByText('520')).toBeInTheDocument();
    expect(screen.getByText(/added up from the 1 items?/i)).toBeInTheDocument();
  });

  /** "recipes, food, or both" — the reason this screen exists rather than a recipe picker. */
  it('adds a loose food alongside a recipe, using the app’s own serving math', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: /Add a recipe/i }));
    await user.click(screen.getByRole('button', { name: /Chicken thighs/i }));

    await user.click(screen.getByRole('button', { name: /Add a food/i }));
    await user.type(screen.getByLabelText('Search your foods'), 'olive');
    await user.click(await screen.findByRole('button', { name: 'Olive oil' }));

    // 520 + one tablespoon of olive oil (884 kcal/100g × 13.5g ≈ 119).
    await waitFor(() => expect(screen.getByText('639')).toBeInTheDocument());
  });

  /**
   * An item with no macros must not be silently counted as zero — the honesty line says how many
   * were counted. Same rule the food log learned the hard way on 2026-08-20.
   */
  it('says how many items it could count when one has no numbers', async () => {
    api.getFoodById.mockResolvedValue({ status: 'ok', food: null });
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: /Add a recipe/i }));
    await user.click(screen.getByRole('button', { name: /Chicken thighs/i }));
    await user.click(screen.getByRole('button', { name: /Add a food/i }));
    await user.type(screen.getByLabelText('Search your foods'), 'olive');
    await user.click(await screen.findByRole('button', { name: 'Olive oil' }));

    expect(await screen.findByText(/added up from 1 of the 2 items/i)).toBeInTheDocument();
  });

  it('saves a named meal onto the chosen day and slot — not to the food log', async () => {
    const { user, onSave } = setup();
    await user.type(screen.getByLabelText('What to call this meal'), 'Thighs, orzo & a side salad');
    await user.click(screen.getByRole('button', { name: /Add a recipe/i }));
    await user.click(screen.getByRole('button', { name: /Chicken thighs/i }));

    const save = await screen.findByRole('button', { name: /Save & put on/i });
    await user.click(save);

    expect(onSave).toHaveBeenCalledWith(
      '2026-09-03',
      'dinner',
      expect.objectContaining({
        name: 'Thighs, orzo & a side salad',
        items: [expect.objectContaining({ kind: 'recipe', id: 'r1', kcal: 520 })],
      }),
    );
  });

  /**
   * MP20 — no writer ever set a planned item's qty to anything but 1. Bumping the amount control
   * has to rescale that item's macros AND move the running total, or the number on the card would
   * stop matching what it says.
   */
  it('scales a recipe item’s macros — and the total — when its amount changes', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: /Add a recipe/i }));
    await user.click(screen.getByRole('button', { name: /Chicken thighs/i }));

    await user.click(await screen.findByRole('button', { name: /More Chicken thighs/i }));
    await user.click(screen.getByRole('button', { name: /More Chicken thighs/i }));
    await user.click(screen.getByRole('button', { name: /More Chicken thighs/i }));
    // 3 × 0.25 = 0.75 more than the 1 it started at → 1.75 servings.
    expect(screen.getByText('1.75')).toBeInTheDocument();
    // 520 kcal/serving × 1.75 = 910.
    expect(await screen.findByText('910')).toBeInTheDocument();
  });

  it('saves the amount the user actually chose, not the hardcoded 1 the composer used to write', async () => {
    const { user, onSave } = setup();
    await user.click(screen.getByRole('button', { name: /Add a recipe/i }));
    await user.click(screen.getByRole('button', { name: /Chicken thighs/i }));
    await user.click(await screen.findByRole('button', { name: /More Chicken thighs/i }));

    await user.click(await screen.findByRole('button', { name: /Save & put on/i }));

    expect(onSave).toHaveBeenCalledWith(
      '2026-09-03',
      'dinner',
      expect.objectContaining({ items: [expect.objectContaining({ qty: 1.25, kcal: 650 })] }),
    );
  });

  /** The ruling, in this screen too: no button anywhere offers to log. */
  it('offers no way to log', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: /Add a recipe/i }));
    await user.click(screen.getByRole('button', { name: /Chicken thighs/i }));
    for (const b of screen.getAllByRole('button')) {
      expect(b.textContent ?? '').not.toMatch(/\blog\b/i);
    }
  });

  it('lets you take an item back out', async () => {
    const { user } = setup();
    await user.click(screen.getByRole('button', { name: /Add a recipe/i }));
    await user.click(screen.getByRole('button', { name: /Chicken thighs/i }));
    await user.click(await screen.findByRole('button', { name: /Take Chicken thighs & lemon orzo out/i }));
    expect(screen.getByRole('button', { name: /Add something first/i })).toBeDisabled();
  });
});
