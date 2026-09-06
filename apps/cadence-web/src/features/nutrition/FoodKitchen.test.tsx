/**
 * The Kitchen is PREP (Food Journey 10, 10a–c). What these pin, in the order they matter:
 *   • the ruling — there is no way to log a meal from this tab, on any of its screens;
 *   • the composer really writes: a recipe put on a day reaches the server as that day and slot,
 *     creating the week when there isn't one and patching it when there is;
 *   • the shopping list is DERIVED from what is planned and never written back;
 *   • emptying the week clears it, because a week with no meals is not a shape the API stores.
 *
 * These drive the real components through clicks and assert on what is on the screen and what
 * reached the API — not on whether a string exists somewhere in the source.
 */
import { screen, within, waitFor, fireEvent, cleanup } from '@testing-library/react';
import { renderWithQuery } from '../../test/withQuery.tsx';
import type { Recipe } from '@cadence/shared';

const listRecipes = vi.fn();
const getCurrentMealPlan = vi.fn();
const patchMealPlan = vi.fn();
const saveMealPlan = vi.fn();
const deleteMealPlan = vi.fn();
const getDietaryProfile = vi.fn();
const structureRecipeFromChat = vi.fn();
const probeRecipeDiscovery = vi.fn();
const generateMealPlan = vi.fn();

vi.mock('../../lib/api.ts', () => ({
  listRecipes: (...a: unknown[]) => listRecipes(...a),
  getCurrentMealPlan: (...a: unknown[]) => getCurrentMealPlan(...a),
  patchMealPlan: (...a: unknown[]) => patchMealPlan(...a),
  saveMealPlan: (...a: unknown[]) => saveMealPlan(...a),
  deleteMealPlan: (...a: unknown[]) => deleteMealPlan(...a),
  getDietaryProfile: (...a: unknown[]) => getDietaryProfile(...a),
  structureRecipeFromChat: (...a: unknown[]) => structureRecipeFromChat(...a),
  probeRecipeDiscovery: (...a: unknown[]) => probeRecipeDiscovery(...a),
  discoverRecipes: vi.fn(),
  parseFridgePhoto: vi.fn(),
  generateRecipesFromIngredients: vi.fn(),
  saveRecipe: vi.fn(),
  generateMealPlan: (...a: unknown[]) => generateMealPlan(...a),
  mealPlanDayLabel: (d: string) => d,
  shoppingListSummary: (l: unknown[]) => `${l.length} to get`,
  weekOfMonday: () => '2026-08-24',
  // The real one-liner, not a stub — the per-serving numbers are the point of 10a.
  recipeMacroHint: (m: { kcal?: number; protein_g?: number }) =>
    [m.kcal != null ? `~${Math.round(m.kcal)} kcal` : '', m.protein_g != null ? `P${Math.round(m.protein_g)}` : '']
      .filter(Boolean)
      .join(' · '),
}));

vi.mock('../../components/MicButton.tsx', () => ({ MicButton: () => null }));

const { FoodKitchen } = await import('./FoodKitchen.tsx');

const chili: Recipe = {
  recipe_id: 'r-chili',
  name: 'Beef chili',
  source: 'user',
  servings: 4,
  ingredients: [
    { name: 'ground beef', qty: 500, unit: 'g' },
    { name: 'kidney beans', qty: 2, unit: 'can' },
  ],
  steps: ['brown the beef', 'simmer'],
  macros_per_serving: { kcal: 520, protein_g: 32 },
  tags: [],
  saved: true,
};

const dal: Recipe = {
  ...chili,
  recipe_id: 'r-dal',
  name: 'Red lentil dal',
  ingredients: [{ name: 'red lentils', qty: 300, unit: 'g' }],
  macros_per_serving: { kcal: 380, protein_g: 18 },
};

const savedWeek = {
  meal_plan_id: 'mp1',
  week_of: '2026-08-24',
  days: [{ day: '2026-08-26', meals: [{ slot: 'dinner', recipe_id: 'r-chili', recipe_name: 'Beef chili' }] }],
  shopping_list: [{ name: 'ground beef', qty: '500 g', category: 'protein', checked: false }],
};

beforeEach(() => {
  vi.clearAllMocks();
  listRecipes.mockResolvedValue({ status: 'ok', recipes: [chili, dal] });
  getCurrentMealPlan.mockResolvedValue({ status: 'not_found', plan: null });
  getDietaryProfile.mockResolvedValue({ status: 'ok', profile: { allergies: [], dislikes: [] } });
  probeRecipeDiscovery.mockResolvedValue(false);
});
afterEach(cleanup);

/** Wait past the hook's two opening fetches so the tab is settled before we click. */
async function mountKitchen() {
  const view = renderWithQuery(<FoodKitchen />);
  await waitFor(() => expect(getCurrentMealPlan).toHaveBeenCalled());
  return view;
}

describe('the Kitchen is prep, not one-tap logging', () => {
  it('offers no way to log a meal — not in the recipe list, not in a recipe, not on a day', async () => {
    getCurrentMealPlan.mockResolvedValue({ status: 'ok', plan: savedWeek });
    await mountKitchen();

    const noLogButton = () => {
      for (const b of screen.getAllByRole('button')) {
        expect(b.textContent ?? '').not.toMatch(/\blog\b/i);
      }
    };

    await screen.findByRole('button', { name: /Beef chili/i });
    noLogButton();

    fireEvent.click(screen.getByRole('button', { name: /Beef chili/i }));
    expect(screen.getByRole('region', { name: /Recipe — Beef chili/i })).toBeInTheDocument();
    noLogButton();

    fireEvent.click(screen.getByRole('button', { name: /All recipes/i }));
    fireEvent.click(screen.getByRole('tab', { name: 'The week' }));
    fireEvent.click(screen.getByRole('button', { name: /Thu 27 Aug/i }));
    noLogButton();
  });

  it('says plainly that planning is not counting', async () => {
    await mountKitchen();
    expect(screen.getByText(/Planning something doesn't count it — log it when you eat it\./i)).toBeInTheDocument();
  });
});

describe('recipes carry their per-serving numbers (10a)', () => {
  it('shows servings and the per-serving macros on every row', async () => {
    await mountKitchen();
    const row = await screen.findByRole('button', { name: /Beef chili/i });
    expect(row).toHaveTextContent('Serves 4');
    expect(row).toHaveTextContent('~520 kcal · P32 per serving');
  });

  it('opens a recipe onto its ingredients and steps', async () => {
    await mountKitchen();
    fireEvent.click(await screen.findByRole('button', { name: /Red lentil dal/i }));
    const detail = screen.getByRole('region', { name: /Recipe — Red lentil dal/i });
    expect(within(detail).getByText('red lentils')).toBeInTheDocument();
    expect(within(detail).getByText('300 g')).toBeInTheDocument();
  });

  it('is honest, not empty-handed, when there is nothing saved', async () => {
    listRecipes.mockResolvedValue({ status: 'ok', recipes: [] });
    await mountKitchen();
    expect(await screen.findByText(/Nothing saved yet/i)).toBeInTheDocument();
  });
});

describe('the composer — a recipe onto a day and a slot (10b)', () => {
  /**
   * Creating a week is TWO calls — create from recipes, then patch the composed days over it — and
   * the patch is an upgrade, never a requirement. The week already exists by then.
   *
   * This is here because the original code read the patch result unguarded, so an absent one threw
   * an unhandled rejection. Vitest reported the suite GREEN and failed the run: the throw happened
   * after the assertions, so nothing asserted was wrong and the feature was still broken. Only CI
   * surfaced it. Both failure shapes are covered — a rejection, and a result that is not there.
   */
  it.each([
    ['the patch rejects', () => Promise.reject(new Error('offline'))],
    ['the patch answers with nothing', () => Promise.resolve(undefined)],
  ])('still saves the week when %s', async (_label, behaviour) => {
    saveMealPlan.mockResolvedValue({ status: 'ok', plan: savedWeek });
    patchMealPlan.mockImplementation(behaviour as () => Promise<never>);
    await mountKitchen();

    fireEvent.click(await screen.findByRole('button', { name: /Beef chili/i }));
    fireEvent.click(screen.getByRole('button', { name: /Put it on a day/i }));
    fireEvent.click(screen.getByRole('button', { name: /Wed 26 Aug/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Dinner' }));

    // The week that was created survives; nothing throws.
    await waitFor(() => expect(saveMealPlan).toHaveBeenCalled());
    await waitFor(() => expect(patchMealPlan).toHaveBeenCalled());
  });

  it('creates the week when there is none, reusing the saved recipe rather than copying it', async () => {
    saveMealPlan.mockResolvedValue({ status: 'ok', plan: savedWeek });
    await mountKitchen();

    fireEvent.click(await screen.findByRole('button', { name: /Beef chili/i }));
    fireEvent.click(screen.getByRole('button', { name: /Put it on a day/i }));
    expect(screen.getByText(/When are you making Beef chili\?/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Wed 26 Aug/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Dinner' }));

    await waitFor(() => expect(saveMealPlan).toHaveBeenCalled());
    const body = saveMealPlan.mock.calls[0]?.[0];
    expect(body.week_of).toBe('2026-08-24');
    expect(body.days).toEqual([
      {
        day: '2026-08-26',
        meals: [
          {
            slot: 'dinner',
            recipe: expect.objectContaining({ name: 'Beef chili', reuse_recipe_id: 'r-chili', servings: 4 }),
          },
        ],
      },
    ]);
    // Generated, never kept: the Kitchen writes no list of its own.
    expect(body.shopping_list).toEqual([]);
  });

  it('patches an existing week, and touches only its days', async () => {
    getCurrentMealPlan.mockResolvedValue({ status: 'ok', plan: savedWeek });
    patchMealPlan.mockResolvedValue({ status: 'ok', plan: savedWeek });
    await mountKitchen();

    fireEvent.click(screen.getByRole('tab', { name: 'The week' }));
    fireEvent.click(await screen.findByRole('button', { name: /Tue 25 Aug/i }));
    fireEvent.click(
      within(screen.getByRole('region', { name: /Plan Tue 25 Aug/i })).getAllByRole('button', {
        name: /Pick a recipe/i,
      })[0]!,
    );
    fireEvent.click(screen.getByRole('button', { name: /Red lentil dal/i }));

    await waitFor(() => expect(patchMealPlan).toHaveBeenCalled());
    const [id, patch] = patchMealPlan.mock.calls[0]!;
    expect(id).toBe('mp1');
    expect(Object.keys(patch)).toEqual(['days']);
    expect(patch.days).toEqual([
      { day: '2026-08-25', meals: [{ slot: 'breakfast', recipe_id: 'r-dal', recipe_name: 'Red lentil dal' }] },
      { day: '2026-08-26', meals: [{ slot: 'dinner', recipe_id: 'r-chili', recipe_name: 'Beef chili' }] },
    ]);
  });

  it('shows what a day already holds instead of an empty grid', async () => {
    getCurrentMealPlan.mockResolvedValue({ status: 'ok', plan: savedWeek });
    await mountKitchen();
    fireEvent.click(screen.getByRole('tab', { name: 'The week' }));
    expect(await screen.findByText(/1 meal planned this week\./i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Wed 26 Aug/i })).toHaveTextContent('Dinner: Beef chili');
  });

  it('clears the week when the last meal comes off — a week with no meals cannot be stored', async () => {
    getCurrentMealPlan.mockResolvedValue({ status: 'ok', plan: savedWeek });
    deleteMealPlan.mockResolvedValue({ status: 'ok' });
    await mountKitchen();

    fireEvent.click(screen.getByRole('tab', { name: 'The week' }));
    fireEvent.click(await screen.findByRole('button', { name: /Wed 26 Aug/i }));
    fireEvent.click(screen.getByRole('button', { name: /Take it off/i }));

    await waitFor(() => expect(deleteMealPlan).toHaveBeenCalledWith('mp1'));
    expect(patchMealPlan).not.toHaveBeenCalled();
  });
});

describe('the shopping list is generated, never kept (10c)', () => {
  it('works the list out from the planned recipes — merely LOOKING writes nothing', async () => {
    getCurrentMealPlan.mockResolvedValue({ status: 'ok', plan: savedWeek });
    await mountKitchen();

    fireEvent.click(screen.getByRole('tab', { name: 'Shopping' }));
    const list = await screen.findByRole('region', { name: /Shopping list/i });
    // Chili's own ingredients — derived, not the single-item list stored on the plan.
    expect(within(list).getByText('ground beef')).toBeInTheDocument();
    expect(within(list).getByText('kidney beans')).toBeInTheDocument();
    expect(within(list).getByText('2 things left')).toBeInTheDocument();
    expect(within(list).getByText(/WORKED OUT FROM THIS WEEK/i)).toBeInTheDocument();
    expect(patchMealPlan).not.toHaveBeenCalled();
  });

  /**
   * Owner ruling 2026-09-02: the ticks are KEPT (the session-only version lost the basket to a
   * phone lock mid-shop). A toggle writes the derived list with its checked flags onto the plan
   * row — the plan's DAYS are never touched, so the list itself still re-derives and cannot go
   * stale.
   */
  it('a tick persists to the plan row, and only the ticks — never the days', async () => {
    getCurrentMealPlan.mockResolvedValue({ status: 'ok', plan: savedWeek });
    patchMealPlan.mockResolvedValue({ status: 'ok', plan: savedWeek });
    await mountKitchen();

    fireEvent.click(screen.getByRole('tab', { name: 'Shopping' }));
    const row = await screen.findByRole('button', { name: /ground beef/i });
    fireEvent.click(row);

    expect(screen.getByRole('button', { name: /ground beef/i }).className).toMatch(/is-checked/);
    expect(screen.getByText('1 thing left')).toBeInTheDocument();
    await waitFor(() => expect(patchMealPlan).toHaveBeenCalledTimes(1));
    const [id, patch] = patchMealPlan.mock.calls[0]!;
    expect(id).toBe('mp1');
    expect(Object.keys(patch)).toEqual(['shopping_list']);
    expect(patch.shopping_list).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'ground beef', checked: true })]),
    );
    expect(saveMealPlan).not.toHaveBeenCalled();
  });

  it('seeds the basket from the plan row, so a tick survives leaving and coming back', async () => {
    getCurrentMealPlan.mockResolvedValue({
      status: 'ok',
      plan: { ...savedWeek, shopping_list: [{ name: 'kidney beans', qty: '400 g', category: 'other', checked: true }] },
    });
    await mountKitchen();

    fireEvent.click(screen.getByRole('tab', { name: 'Shopping' }));
    const row = await screen.findByRole('button', { name: /kidney beans/i });
    expect(row.className).toMatch(/is-checked/);
    expect(screen.getByText('1 thing left')).toBeInTheDocument();
  });

  it('points at planning rather than showing an empty list when nothing is planned', async () => {
    await mountKitchen();
    fireEvent.click(screen.getByRole('tab', { name: 'Shopping' }));
    expect(await screen.findByText(/Plan a few meals and I'll work out what to buy\./i)).toBeInTheDocument();
  });
});

describe('the paste-a-recipe door (10)', () => {
  it('opens the structure-from-text panel', async () => {
    await mountKitchen();
    fireEvent.click(screen.getByRole('button', { name: /Paste a recipe/i }));
    expect(await screen.findByRole('region', { name: /Structure recipe from text/i })).toBeInTheDocument();
  });

  it('drafts nothing until there is text, and saves nothing until it is confirmed', async () => {
    structureRecipeFromChat.mockResolvedValue({
      status: 'ok',
      draft: {
        name: 'Shakshuka',
        source: 'ai_from_chat',
        servings: 2,
        ingredients: [{ name: 'eggs', qty: 4 }],
        steps: [],
        macros_per_serving: { kcal: 310 },
        tags: [],
      },
    });
    await mountKitchen();
    fireEvent.click(screen.getByRole('button', { name: /Paste a recipe/i }));

    const draftBtn = await screen.findByRole('button', { name: /Draft recipe/i });
    expect(draftBtn).toBeDisabled();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'shakshuka, 4 eggs, serves 2' } });
    fireEvent.click(screen.getByRole('button', { name: /Draft recipe/i }));

    await waitFor(() => expect(structureRecipeFromChat).toHaveBeenCalledWith('shakshuka, 4 eggs, serves 2'));
    // The draft is on screen and still unsaved — the confirm card is the only way it lands.
    expect(await screen.findByDisplayValue('Shakshuka')).toBeInTheDocument();
  });
});

/**
 * The Day tab's pills and doors land HERE now (the July panel stack is gone), so the Kitchen
 * accepts the section it should open on. The tab still defaults to the cookbook.
 */
describe('opening on a named section (the pill re-point)', () => {
  it('opens on the shopping list when asked', async () => {
    getCurrentMealPlan.mockResolvedValue({ status: 'ok', plan: savedWeek });
    renderWithQuery(<FoodKitchen initialView="shop" />);
    expect(await screen.findByRole('region', { name: /Shopping list/i })).toBeInTheDocument();
    // The plan lands after the deep-linked mount — its saved ticks seed the basket in place.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /ground beef/i }).className).not.toMatch(/is-checked/),
    );
  });

  it('opens on the planner when asked', async () => {
    getCurrentMealPlan.mockResolvedValue({ status: 'ok', plan: savedWeek });
    renderWithQuery(<FoodKitchen initialView="week" />);
    expect(await screen.findByRole('region', { name: /Plan the week/i })).toBeInTheDocument();
  });
});

/**
 * The two intake doors the old cookbook panel carried, moved in with the recipes: the fridge
 * photo, and — only when the endpoint answers the probe — recipe discovery. Both end at the same
 * confirm card the paste door uses; the panels themselves have their own tests.
 */
describe('the other ways a recipe gets in', () => {
  it('opens snap-the-fridge from the cookbook', async () => {
    await mountKitchen();
    fireEvent.click(await screen.findByRole('button', { name: /Snap the fridge/i }));
    expect(await screen.findByRole('region', { name: /Snap fridge or pantry/i })).toBeInTheDocument();
  });

  it('hides recipe discovery while the endpoint is not live', async () => {
    await mountKitchen();
    await screen.findByRole('button', { name: /Snap the fridge/i });
    expect(screen.queryByRole('button', { name: /Find a real recipe/i })).toBeNull();
  });

  it('offers recipe discovery once the probe says it is live', async () => {
    probeRecipeDiscovery.mockResolvedValue(true);
    await mountKitchen();
    fireEvent.click(await screen.findByRole('button', { name: /Find a real recipe/i }));
    expect(await screen.findByRole('region', { name: /Find a real recipe/i })).toBeInTheDocument();
  });
});

/**
 * Owner rulings, 2026-09-02 — the capabilities the July-panel deletion dropped come back as
 * Kitchen capabilities: week paging (read-only past), and AI week-drafting in the Kitchen.
 */
describe('week paging — \u2039 walks into past weeks, read-only', () => {
  it('fetches the earlier week and stows every editing door', async () => {
    getCurrentMealPlan.mockResolvedValue({ status: 'ok', plan: savedWeek });
    await mountKitchen();
    fireEvent.click(screen.getByRole('tab', { name: 'The week' }));
    await screen.findByRole('button', { name: /Draft this week/i });

    fireEvent.click(screen.getByRole('button', { name: 'Earlier week' }));
    await waitFor(() => expect(getCurrentMealPlan).toHaveBeenCalledWith('2026-08-17'));
    expect(await screen.findByRole('button', { name: /Back to this week/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Draft this week/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Define a meal/i })).toBeNull();

    // A past day reads back, but its slots take no edits.
    fireEvent.click(screen.getAllByRole('button', { name: /Mon 17 Aug|Tue 18 Aug/i })[0]!);
    expect(screen.queryByRole('button', { name: /Pick a recipe/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Take it off/i })).toBeNull();
  });

  it('the later-week arrow never pages past the running week', async () => {
    await mountKitchen();
    fireEvent.click(screen.getByRole('tab', { name: 'The week' }));
    expect((await screen.findByRole('button', { name: 'Later week' })).hasAttribute('disabled')).toBe(true);
  });
});

describe('AI week-drafting, back in the Kitchen', () => {
  const draft = {
    week_of: '2026-08-24',
    days: [
      {
        day: '2026-08-24',
        meals: [{ slot: 'dinner', recipe: { name: 'Beef chili', servings: 4, ingredients: [], steps: [], tags: [] } }],
      },
    ],
    shopping_list: [{ name: 'ground beef', qty: '500 g', category: 'protein', checked: false }],
    notes: null,
  };

  it('drafts from a note and keeps nothing until "Keep this week"', async () => {
    generateMealPlan.mockResolvedValue({ status: 'ok', draft });
    saveMealPlan.mockResolvedValue({ status: 'ok', plan: savedWeek });
    await mountKitchen();
    fireEvent.click(screen.getByRole('tab', { name: 'The week' }));
    fireEvent.click(await screen.findByRole('button', { name: /Draft this week/i }));

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'more fish' } });
    fireEvent.click(screen.getByRole('button', { name: /Draft the week/i }));
    await waitFor(() =>
      expect(generateMealPlan).toHaveBeenCalledWith({
        week_of: '2026-08-24',
        slots: ['dinner'],
        prefs: 'more fish',
      }),
    );
    // The draft is on screen and still unsaved — keeping is the only way it lands.
    expect(await screen.findByText(/dinner: Beef chili/i)).toBeInTheDocument();
    expect(saveMealPlan).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Keep this week/i }));
    await waitFor(() => expect(saveMealPlan).toHaveBeenCalledWith(draft));
  });

  it('drafts the slots the user picked — dinners only by default, none disables the button', async () => {
    generateMealPlan.mockResolvedValue({ status: 'ok', draft });
    await mountKitchen();
    fireEvent.click(screen.getByRole('tab', { name: 'The week' }));
    fireEvent.click(await screen.findByRole('button', { name: /Draft this week/i }));

    expect(screen.getByRole('button', { name: 'Dinners' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Breakfasts' }));
    fireEvent.click(screen.getByRole('button', { name: /Draft the week/i }));
    await waitFor(() =>
      expect(generateMealPlan).toHaveBeenCalledWith({ week_of: '2026-08-24', slots: ['breakfast', 'dinner'] }),
    );

    fireEvent.click(await screen.findByRole('button', { name: /Try a different note/i }));
    fireEvent.click(screen.getByRole('button', { name: 'Breakfasts' }));
    fireEvent.click(screen.getByRole('button', { name: 'Dinners' }));
    expect(screen.getByText(/Pick at least one meal to draft/i)).toBeInTheDocument();
    expect((screen.getByRole('button', { name: /Draft the week/i }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('says plainly that keeping a draft replaces an already-planned week', async () => {
    getCurrentMealPlan.mockResolvedValue({ status: 'ok', plan: savedWeek });
    generateMealPlan.mockResolvedValue({ status: 'ok', draft });
    await mountKitchen();
    fireEvent.click(screen.getByRole('tab', { name: 'The week' }));
    fireEvent.click(await screen.findByRole('button', { name: /Draft this week/i }));
    fireEvent.click(screen.getByRole('button', { name: /Draft the week/i }));
    expect(await screen.findByText(/replaces what's planned for the week/i)).toBeInTheDocument();
  });
});
