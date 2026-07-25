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

    await waitFor(() => expect(screen.getByText(/food memory is still warming up/i)).toBeInTheDocument());
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

  it('opens search fallback and explains when search is not ready', async () => {
    getFoodRecents.mockResolvedValue({ status: 'empty', foods: [] });
    searchFoods.mockResolvedValue({ status: 'unavailable', foods: [] });
    render(<FoodView />);

    fireEvent.click(screen.getByRole('button', { name: /Search/i }));
    fireEvent.change(screen.getByPlaceholderText(/yogurt/i), { target: { value: 'chili' } });

    await waitFor(() => expect(searchFoods).toHaveBeenCalledWith('chili'));
    expect(screen.getByText(/Search isn't hooked up yet/i)).toBeInTheDocument();
  });
});
