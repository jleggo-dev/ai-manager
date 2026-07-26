import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { RecipesPanel } from './RecipesPanel.tsx';

const listRecipes = vi.fn();
const getRecipeById = vi.fn();
const structureRecipeFromChat = vi.fn();
const parseFridgePhoto = vi.fn();
const generateRecipesFromIngredients = vi.fn();
const saveRecipe = vi.fn();
const logMealFromRecipe = vi.fn();
const probeRecipeDiscovery = vi.fn();

vi.mock('../../lib/api.ts', () => ({
  listRecipes: (...args: unknown[]) => listRecipes(...args),
  getRecipeById: (...args: unknown[]) => getRecipeById(...args),
  structureRecipeFromChat: (...args: unknown[]) => structureRecipeFromChat(...args),
  parseFridgePhoto: (...args: unknown[]) => parseFridgePhoto(...args),
  generateRecipesFromIngredients: (...args: unknown[]) => generateRecipesFromIngredients(...args),
  saveRecipe: (...args: unknown[]) => saveRecipe(...args),
  logMealFromRecipe: (...args: unknown[]) => logMealFromRecipe(...args),
  probeRecipeDiscovery: (...args: unknown[]) => probeRecipeDiscovery(...args),
  recipeMacroHint: (m: { kcal?: number; protein_g?: number }) => {
    const bits: string[] = [];
    if (m.kcal != null) bits.push(`~${Math.round(m.kcal)} kcal`);
    if (m.protein_g != null) bits.push(`P${Math.round(m.protein_g)}`);
    return bits.join(' · ');
  },
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

function chiliRecipe() {
  return {
    recipe_id: 'r1',
    name: 'Beef chili',
    source: 'ai_from_chat' as const,
    servings: 6,
    ingredients: [
      { name: 'ground beef', qty: 500, unit: 'g', food_id: 'f1' },
      { name: 'beans', qty: 2, unit: 'can' },
    ],
    steps: [],
    macros_per_serving: { kcal: 320, protein_g: 28, carbs_g: 22, fat_g: 12 },
    tags: [],
    saved: true,
  };
}

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onClose = vi.fn();
  const onLogged = vi.fn();
  const view = render(
    <QueryClientProvider client={client}>
      <RecipesPanel dietary={null} onClose={onClose} onLogged={onLogged} />
    </QueryClientProvider>,
  );
  return { ...view, onClose, onLogged };
}

describe('RecipesPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listRecipes.mockResolvedValue({ status: 'ok', recipes: [] });
    probeRecipeDiscovery.mockResolvedValue(false);
  });

  it('warm-messages when recipes API is unavailable', async () => {
    listRecipes.mockResolvedValue({ status: 'unavailable', recipes: [] });
    renderPanel();
    await waitFor(() => expect(screen.getByText(/aren't live on the server yet/i)).toBeInTheDocument());
    expect(screen.getByRole('button', { name: /Snap the fridge/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Structure from text/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Find a real recipe/i })).not.toBeInTheDocument();
  });

  it('shows discovery only when API probe is live', async () => {
    probeRecipeDiscovery.mockResolvedValue(true);
    renderPanel();
    await waitFor(() => expect(screen.getByRole('button', { name: /Find a real recipe/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Find a real recipe/i }));
    expect(screen.getByRole('region', { name: /Find a real recipe/i })).toBeInTheDocument();
  });

  it('snap-the-fridge entry opens confirm-before-save fridge flow', async () => {
    renderPanel();
    await waitFor(() => expect(screen.getByRole('button', { name: /Snap the fridge/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Snap the fridge/i }));
    expect(screen.getByRole('region', { name: /Snap fridge or pantry/i })).toBeInTheDocument();
    expect(screen.getByText(/Nothing is saved until you say so/i)).toBeInTheDocument();
  });

  it('lists recipes and opens detail → log-again confirm', async () => {
    const recipe = chiliRecipe();
    listRecipes.mockResolvedValue({ status: 'ok', recipes: [recipe] });
    getRecipeById.mockResolvedValue({ status: 'ok', recipe });
    logMealFromRecipe.mockResolvedValue({ log_id: 'm1' });

    const { onLogged } = renderPanel();
    await waitFor(() => expect(screen.getByText('Beef chili')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Beef chili/i }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Log again/i })).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Log again/i }));
    expect(screen.getByText(/Log Beef chili/i)).toBeInTheDocument();
    expect(logMealFromRecipe).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Looks right — log it/i }));
    await waitFor(() =>
      expect(logMealFromRecipe).toHaveBeenCalledWith(expect.objectContaining({ recipe_id: 'r1', servings: 1 })),
    );
    await waitFor(() => expect(onLogged).toHaveBeenCalled());
  });

  it('structure-from-text → confirm save before anything persists', async () => {
    structureRecipeFromChat.mockResolvedValue({
      status: 'ok',
      draft: {
        name: 'Beef chili',
        source: 'ai_from_chat',
        servings: 6,
        ingredients: [{ name: 'beef', qty: 500, unit: 'g' }],
        steps: [],
        macros_per_serving: { kcal: 320 },
        tags: [],
      },
    });
    saveRecipe.mockResolvedValue({ status: 'ok', recipe: chiliRecipe() });

    renderPanel();
    await waitFor(() => expect(screen.getByRole('button', { name: /Structure from text/i })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /Structure from text/i }));
    fireEvent.change(screen.getByPlaceholderText(/chili with 500g/i), {
      target: { value: 'chili with 500g beef, makes 6' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Draft recipe/i }));

    await waitFor(() => expect(structureRecipeFromChat).toHaveBeenCalled());
    expect(screen.getByText(/Here's the recipe I drafted/i)).toBeInTheDocument();
    expect(saveRecipe).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /Looks right — save recipe/i }));
    await waitFor(() => expect(saveRecipe).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('button', { name: /Log again/i })).toBeInTheDocument());
  });
});
