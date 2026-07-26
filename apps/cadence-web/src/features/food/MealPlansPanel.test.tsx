import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MealPlansPanel } from './MealPlansPanel.tsx';

const listMealPlans = vi.fn();
const getCurrentMealPlan = vi.fn();
const generateMealPlan = vi.fn();
const saveMealPlan = vi.fn();

vi.mock('../../lib/api.ts', () => ({
  listMealPlans: (...args: unknown[]) => listMealPlans(...args),
  getCurrentMealPlan: (...args: unknown[]) => getCurrentMealPlan(...args),
  generateMealPlan: (...args: unknown[]) => generateMealPlan(...args),
  saveMealPlan: (...args: unknown[]) => saveMealPlan(...args),
  patchMealPlan: vi.fn(),
  weekOfMonday: () => '2026-07-20',
  mealPlanDayLabel: (d: string) => d,
  shoppingListSummary: (list: { checked: boolean }[]) =>
    list.length ? `${list.filter((i) => !i.checked).length} to get · ${list.length} total` : 'No shopping list yet',
}));

function samplePlan() {
  return {
    meal_plan_id: 'mp1',
    week_of: '2026-07-20',
    days: [
      {
        day: '2026-07-20',
        meals: [{ slot: 'dinner', recipe_id: 'r1', recipe_name: 'Beef chili' }],
      },
    ],
    shopping_list: [
      { name: 'ground beef', qty: '500g', category: 'protein', checked: false },
      { name: 'beans', qty: '2 cans', category: 'pantry', checked: true },
    ],
  };
}

function sampleDraft() {
  return {
    week_of: '2026-07-20',
    days: [
      {
        day: '2026-07-20',
        meals: [
          {
            slot: 'dinner',
            recipe: {
              name: 'Beef chili',
              servings: 4,
              ingredients: [{ name: 'ground beef', qty: 500, unit: 'g' }],
              steps: [],
              tags: [],
              reuse_recipe_id: null,
            },
          },
        ],
      },
    ],
    shopping_list: samplePlan().shopping_list,
    notes: 'more fish',
  };
}

describe('MealPlansPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listMealPlans.mockResolvedValue({ status: 'ok', plans: [] });
    getCurrentMealPlan.mockResolvedValue({ status: 'not_found', plan: null });
  });

  it('warm-messages when meal-plans API is unavailable', async () => {
    listMealPlans.mockResolvedValue({ status: 'unavailable', plans: [] });
    getCurrentMealPlan.mockResolvedValue({ status: 'unavailable', plan: null });
    render(<MealPlansPanel onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/aren't live on the server yet/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Plan this week/i })).toBeInTheDocument();
  });

  it('generate → confirm-before-save', async () => {
    const draft = sampleDraft();
    generateMealPlan.mockResolvedValue({ status: 'ok', draft });
    saveMealPlan.mockResolvedValue({ status: 'ok', plan: samplePlan() });
    listMealPlans
      .mockResolvedValueOnce({ status: 'ok', plans: [] })
      .mockResolvedValue({ status: 'ok', plans: [samplePlan()] });
    getCurrentMealPlan
      .mockResolvedValueOnce({ status: 'not_found', plan: null })
      .mockResolvedValue({ status: 'ok', plan: samplePlan() });

    render(<MealPlansPanel onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Plan this week/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Plan this week/i }));
    expect(screen.getByText(/Nothing sticks until you say this week looks right/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Draft the week/i }));
    await waitFor(() => expect(screen.getByText(/Here's the week I drafted/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Yes, keep this week/i }));
    await waitFor(() => expect(saveMealPlan).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByText(/Saved — this week's meals/i)).toBeInTheDocument());
  });

  it('opens saved week and shopping list', async () => {
    const plan = samplePlan();
    listMealPlans.mockResolvedValue({ status: 'ok', plans: [plan] });
    getCurrentMealPlan.mockResolvedValue({ status: 'ok', plan });
    render(<MealPlansPanel onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Week of 2026-07-20/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Week of 2026-07-20/i }));
    expect(screen.getByText(/Beef chili/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Open shopping list/i }));
    expect(screen.getByRole('region', { name: /Shopping list/i })).toBeInTheDocument();
    expect(screen.getByText(/ground beef/i)).toBeInTheDocument();
  });
});
