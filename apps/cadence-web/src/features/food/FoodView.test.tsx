import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { FoodView } from './FoodView.tsx';

const getFoodRecents = vi.fn();
const searchFoods = vi.fn();
const resolveFoods = vi.fn();
const getDietaryProfile = vi.fn();
const estimateFood = vi.fn();
const getFoodById = vi.fn();
const createFood = vi.fn();
const logMealFromFood = vi.fn();
const parseNutritionLabel = vi.fn();
const identifyFood = vi.fn();

vi.mock('../../lib/api.ts', () => ({
  getFoodRecents: (...args: unknown[]) => getFoodRecents(...args),
  searchFoods: (...args: unknown[]) => searchFoods(...args),
  resolveFoods: (...args: unknown[]) => resolveFoods(...args),
  foodSummaryFromResolve: (c: {
    kind: string;
    food_id?: string;
    label: string;
    brand?: string | null;
    preselected_serving?: number;
    inferred_quantity?: number;
  }) => {
    if (c.kind !== 'food' || !c.food_id) return null;
    let name = c.label;
    const brand = typeof c.brand === 'string' ? c.brand : null;
    if (brand && name.endsWith(` (${brand})`)) name = name.slice(0, -(brand.length + 3)).trim();
    return { food_id: c.food_id, name: name || c.label, brand, serving_label: null };
  },
  portionHintFromResolve: (c: { preselected_serving?: number; inferred_quantity?: number }) => {
    const hint: { servingIndex?: number; quantity?: number } = {};
    if (typeof c.preselected_serving === 'number') hint.servingIndex = c.preselected_serving;
    if (typeof c.inferred_quantity === 'number' && c.inferred_quantity > 0) hint.quantity = c.inferred_quantity;
    return hint;
  },
  getDietaryProfile: (...args: unknown[]) => getDietaryProfile(...args),
  estimateFood: (...args: unknown[]) => estimateFood(...args),
  getFoodById: (...args: unknown[]) => getFoodById(...args),
  createFood: (...args: unknown[]) => createFood(...args),
  logMealFromFood: (...args: unknown[]) => logMealFromFood(...args),
  parseNutritionLabel: (...args: unknown[]) => parseNutritionLabel(...args),
  identifyFood: (...args: unknown[]) => identifyFood(...args),
}));

vi.mock('../../components/MicButton.tsx', () => ({
  MicButton: () => (
    <button type="button" aria-label="Dictate">
      mic
    </button>
  ),
}));

vi.mock('../../lib/query/index.ts', () => ({
  useInvalidateNutritionDay: () => vi.fn(async () => undefined),
}));

function yogurtCandidate() {
  return {
    name: 'Nonfat greek yogurt',
    brand: 'Fage',
    source: 'llm' as const,
    base_unit: 'g' as const,
    macros_per_base: { kcal: 59, protein_g: 10.3, carbs_g: 3.5, fat_g: 0 },
    servings: [
      { label: '1 container (170g)', unit: 'container', amount_g: 170 },
      { label: '100 g', unit: 'g', amount_g: 100 },
    ],
    default_serving: 0,
    confidence: 0.7,
    photo_ref: null,
  };
}

function renderFood() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <FoodView />
    </QueryClientProvider>,
  );
}

describe('FoodView capture wire', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getDietaryProfile.mockResolvedValue({
      status: 'unavailable',
      profile: { allergies: [], diet: null, dislikes: [], notes: null },
    });
    getFoodRecents.mockResolvedValue({ status: 'ok', foods: [] });
    searchFoods.mockResolvedValue({ status: 'ok', foods: [] });
    resolveFoods.mockResolvedValue({ status: 'ok', candidates: [], preselected: null });
  });

  it('shows say/snap first and a warm empty state when recents are unavailable', async () => {
    getFoodRecents.mockResolvedValue({ status: 'unavailable', foods: [] });
    renderFood();

    expect(screen.getByRole('button', { name: /Say it/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Snap it/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Search/i })).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText(/Couldn't load your recent foods/i)).toBeInTheDocument());
  });

  it('lists recents when the API returns foods', async () => {
    getFoodRecents.mockResolvedValue({
      status: 'ok',
      foods: [{ food_id: 'f1', name: 'Morning yogurt', brand: 'Fage', serving_label: '1 container' }],
    });
    renderFood();
    await waitFor(() => expect(screen.getByText('Morning yogurt')).toBeInTheDocument());
    expect(screen.getByText(/Fage · 1 container/)).toBeInTheDocument();
  });

  it('opens search fallback and explains when resolve is unreachable', async () => {
    resolveFoods.mockResolvedValue({ status: 'unavailable', candidates: [], preselected: null });
    renderFood();

    fireEvent.click(screen.getByRole('button', { name: /Search/i }));
    fireEvent.change(screen.getByPlaceholderText(/yogurt/i), { target: { value: 'chili' } });

    await waitFor(() => expect(resolveFoods).toHaveBeenCalledWith({ text: 'chili' }));
    expect(screen.getByText(/Search isn't reachable just now/i)).toBeInTheDocument();
  });

  it('lists search hits from resolve', async () => {
    resolveFoods.mockResolvedValue({
      status: 'ok',
      candidates: [
        {
          kind: 'food',
          score: 0.9,
          label: 'Turkey chili',
          food_id: 'f2',
          brand: null,
          preselected_serving: 0,
        },
      ],
      preselected: null,
    });
    renderFood();

    fireEvent.click(screen.getByRole('button', { name: /Search/i }));
    fireEvent.change(screen.getByPlaceholderText(/yogurt/i), { target: { value: 'chili' } });

    await waitFor(() => expect(screen.getByText('Turkey chili')).toBeInTheDocument());
  });

  it('say-it resolves to new → estimate → confirm-first portion picker before logging', async () => {
    resolveFoods.mockResolvedValue({
      status: 'ok',
      candidates: [
        {
          kind: 'new',
          score: 0,
          label: 'Add "nonfat greek yogurt 170g" as a new food',
          capture: { path: 'estimate', text: 'nonfat greek yogurt 170g' },
        },
      ],
      preselected: null,
    });
    estimateFood.mockResolvedValue({ status: 'ok', candidate: yogurtCandidate() });
    createFood.mockResolvedValue({
      food_id: 'new-1',
      ...yogurtCandidate(),
      owner_user_id: 'u',
      visibility: 'private',
      off_id: null,
    });
    logMealFromFood.mockResolvedValue({ log_id: 'm1' });

    renderFood();
    fireEvent.click(screen.getByRole('button', { name: /Say it/i }));
    fireEvent.change(screen.getByPlaceholderText(/greek yogurt/i), {
      target: { value: 'nonfat greek yogurt 170g' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Match it/i }));

    await waitFor(() => expect(resolveFoods).toHaveBeenCalledWith({ text: 'nonfat greek yogurt 170g' }));
    await waitFor(() => expect(estimateFood).toHaveBeenCalledWith('nonfat greek yogurt 170g'));
    expect(screen.getByText(/Here's what I heard/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Looks right — log it/i })).toBeInTheDocument();
    expect(createFood).not.toHaveBeenCalled();
    expect(logMealFromFood).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Looks right — log it/i }));
    await waitFor(() => expect(createFood).toHaveBeenCalled());
    await waitFor(() =>
      expect(logMealFromFood).toHaveBeenCalledWith(
        expect.objectContaining({ food_id: 'new-1', serving_index: 0, quantity: 1 }),
      ),
    );
    await waitFor(() => expect(screen.getByText(/Logged/i)).toBeInTheDocument());
  });

  it('say-it clear-best preselect opens confirm with inferred serving and quantity', async () => {
    const preselected = {
      kind: 'food' as const,
      score: 0.95,
      label: 'Morning yogurt (Fage)',
      food_id: 'f1',
      brand: 'Fage',
      preselected_serving: 1,
      inferred_quantity: 2,
    };
    resolveFoods.mockResolvedValue({
      status: 'ok',
      candidates: [preselected],
      preselected,
    });
    getFoodById.mockResolvedValue({
      status: 'ok',
      food: {
        food_id: 'f1',
        owner_user_id: 'u',
        visibility: 'private',
        off_id: null,
        ...yogurtCandidate(),
        name: 'Morning yogurt',
      },
    });
    logMealFromFood.mockResolvedValue({ log_id: 'm1' });

    renderFood();
    fireEvent.click(screen.getByRole('button', { name: /Say it/i }));
    fireEvent.change(screen.getByPlaceholderText(/greek yogurt/i), { target: { value: '2 yogurt' } });
    fireEvent.click(screen.getByRole('button', { name: /Match it/i }));

    await waitFor(() => expect(getFoodById).toHaveBeenCalledWith('f1'));
    expect(screen.getByText(/Here's what I heard/i)).toBeInTheDocument();
    expect(estimateFood).not.toHaveBeenCalled();
    expect(logMealFromFood).not.toHaveBeenCalled();

    expect(screen.getByDisplayValue('2')).toBeInTheDocument();
    expect((screen.getByLabelText(/^Serving$/i) as HTMLSelectElement).value).toBe('1');

    fireEvent.click(screen.getByRole('button', { name: /Looks right — log it/i }));
    await waitFor(() =>
      expect(logMealFromFood).toHaveBeenCalledWith(
        expect.objectContaining({ food_id: 'f1', serving_index: 1, quantity: 2 }),
      ),
    );
  });

  it('soft-fails warmly when resolve falls back and estimate is unavailable', async () => {
    resolveFoods.mockResolvedValue({
      status: 'unavailable',
      candidates: [],
      preselected: null,
      message: "Food resolve isn't reachable just now — try saying it again in a moment.",
    });
    estimateFood.mockResolvedValue({
      status: 'unavailable',
      message: "Food capture isn't reachable just now — try saying it in Coach, or try again in a moment.",
    });
    renderFood();
    fireEvent.click(screen.getByRole('button', { name: /Say it/i }));
    fireEvent.change(screen.getByPlaceholderText(/greek yogurt/i), { target: { value: 'oats' } });
    fireEvent.click(screen.getByRole('button', { name: /Match it/i }));

    await waitFor(() => expect(screen.getByText(/Food capture isn't reachable/i)).toBeInTheDocument());
    expect(screen.queryByText(/Here's what I heard/i)).not.toBeInTheDocument();
  });

  it('recent pick loads food detail into portion confirm without logging yet', async () => {
    getFoodRecents.mockResolvedValue({
      status: 'ok',
      foods: [{ food_id: 'f1', name: 'Morning yogurt', brand: 'Fage', serving_label: '1 container' }],
    });
    getFoodById.mockResolvedValue({
      status: 'ok',
      food: {
        food_id: 'f1',
        owner_user_id: 'u',
        visibility: 'private',
        off_id: null,
        ...yogurtCandidate(),
        name: 'Morning yogurt',
      },
    });

    renderFood();
    await waitFor(() => expect(screen.getByText('Morning yogurt')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Morning yogurt'));

    await waitFor(() => expect(getFoodById).toHaveBeenCalledWith('f1'));
    expect(screen.getByText(/Here's what I heard/i)).toBeInTheDocument();
    expect(logMealFromFood).not.toHaveBeenCalled();
  });

  it('snap panel offers label read path', async () => {
    renderFood();
    await waitFor(() => expect(getFoodRecents).toHaveBeenCalled());
    fireEvent.click(screen.getByRole('button', { name: /Snap it/i }));
    expect(screen.getByText(/Snap a label/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Read label — I confirm next/i })).toBeInTheDocument();
    expect(parseNutritionLabel).not.toHaveBeenCalled();
    expect(identifyFood).not.toHaveBeenCalled();
  });
});
