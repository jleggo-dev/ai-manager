import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SettingsSheet } from './SettingsSheet.tsx';

const deleteMyData = vi.fn();
const resetAccount = vi.fn();
const isDevMode = vi.fn(() => false);

vi.mock('../../lib/api.ts', () => ({
  deleteMyData: (...args: unknown[]) => deleteMyData(...args),
  resetAccount: (...args: unknown[]) => resetAccount(...args),
  isDevMode: () => isDevMode(),
  getDevAccount: () => 'scratch',
  setMacroTargets: vi.fn(),
  clearMacroTargets: vi.fn(),
  getDietaryProfile: vi.fn().mockResolvedValue({
    status: 'unavailable',
    profile: { allergies: [], diet: null, dislikes: [], notes: null },
  }),
  saveDietaryProfile: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../lib/supabase.ts', () => ({
  supabase: {
    auth: {
      resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }),
      signOut: vi.fn(),
    },
  },
}));

vi.mock('../../lib/query/index.ts', () => ({
  useNutritionDay: () => ({ data: null, isError: false, isFetched: true }),
  useInvalidateNutritionDay: () => vi.fn(),
}));

function renderSheet(email: string | null = 'you@example.com') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <SettingsSheet email={email} onClose={() => {}} onManage={() => {}} />
    </QueryClientProvider>,
  );
}

describe('SettingsSheet — start over phrase gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    isDevMode.mockReturnValue(false);
    deleteMyData.mockResolvedValue(true);
    resetAccount.mockResolvedValue(undefined);
  });

  it('keeps Erase disabled until the exact phrase is typed (trimmed, case-insensitive)', () => {
    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Start over…' }));

    const erase = screen.getByRole('button', { name: 'Erase it all' });
    expect(erase).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('start over'), { target: { value: 'start' } });
    expect(erase).toBeDisabled();

    fireEvent.change(screen.getByPlaceholderText('start over'), { target: { value: '  START OVER  ' } });
    expect(erase).not.toBeDisabled();
  });

  it('real-auth path calls deleteMyData with the confirmation phrase', async () => {
    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload },
    });

    renderSheet();
    fireEvent.click(screen.getByRole('button', { name: 'Start over…' }));
    fireEvent.change(screen.getByPlaceholderText('start over'), { target: { value: 'start over' } });
    fireEvent.click(screen.getByRole('button', { name: 'Erase it all' }));

    await waitFor(() => expect(deleteMyData).toHaveBeenCalledWith('start over'));
    expect(resetAccount).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalled();
  });

  it('dev-mode path calls resetAccount instead of deleteMyData', async () => {
    isDevMode.mockReturnValue(true);
    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload },
    });

    renderSheet(null);
    fireEvent.click(screen.getByRole('button', { name: 'Start over…' }));
    fireEvent.change(screen.getByPlaceholderText('start over'), { target: { value: 'start over' } });
    fireEvent.click(screen.getByRole('button', { name: 'Erase it all' }));

    await waitFor(() => expect(resetAccount).toHaveBeenCalled());
    expect(deleteMyData).not.toHaveBeenCalled();
    expect(reload).toHaveBeenCalled();
  });
});
