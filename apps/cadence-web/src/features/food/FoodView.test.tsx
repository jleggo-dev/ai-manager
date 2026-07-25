import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { FoodView } from './FoodView.tsx';

const getFoodRecents = vi.fn();
const searchFoods = vi.fn();

vi.mock('../../lib/api.ts', () => ({
  getFoodRecents: (...args: unknown[]) => getFoodRecents(...args),
  searchFoods: (...args: unknown[]) => searchFoods(...args),
}));

describe('FoodView shell', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows say/snap first and a warm empty state when recents are unavailable', async () => {
    getFoodRecents.mockResolvedValue({ status: 'unavailable', foods: [] });
    render(<FoodView />);

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
    render(<FoodView />);
    await waitFor(() => expect(screen.getByText('Morning yogurt')).toBeInTheDocument());
    expect(screen.getByText(/Fage · 1 container/)).toBeInTheDocument();
  });

  it('opens search fallback and explains when search is unreachable', async () => {
    getFoodRecents.mockResolvedValue({ status: 'ok', foods: [] });
    searchFoods.mockResolvedValue({ status: 'unavailable', foods: [] });
    render(<FoodView />);

    fireEvent.click(screen.getByRole('button', { name: /Search/i }));
    fireEvent.change(screen.getByPlaceholderText(/yogurt/i), { target: { value: 'chili' } });

    await waitFor(() => expect(searchFoods).toHaveBeenCalledWith('chili'));
    expect(screen.getByText(/Search isn't reachable just now/i)).toBeInTheDocument();
  });

  it('lists search hits from the foods API', async () => {
    getFoodRecents.mockResolvedValue({ status: 'ok', foods: [] });
    searchFoods.mockResolvedValue({
      status: 'ok',
      foods: [{ food_id: 'f2', name: 'Turkey chili', brand: null, serving_label: '1 bowl' }],
    });
    render(<FoodView />);

    fireEvent.click(screen.getByRole('button', { name: /Search/i }));
    fireEvent.change(screen.getByPlaceholderText(/yogurt/i), { target: { value: 'chili' } });

    await waitFor(() => expect(screen.getByText('Turkey chili')).toBeInTheDocument());
  });
});
