import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import ProviderManager from './ProviderManager';
import * as api from '../../services/api';

vi.mock('../../services/api', () => ({
  listProviders: vi.fn(),
  createProvider: vi.fn(),
  updateProvider: vi.fn(),
  deleteProvider: vi.fn(),
  testProvider: vi.fn(),
}));

vi.mock('../../hooks/useConfirm', () => ({
  default: () => vi.fn(() => Promise.resolve(true)),
}));

vi.mock('@mantine/notifications', () => ({
  notifications: { show: vi.fn() },
}));

const paginatedEmpty = {
  data: [],
  pagination: { next_cursor: null, prev_cursor: null, has_more: false, limit: 25 },
};

const mockProviders = [
  {
    id: '1',
    name: 'Devs.ai Corporate',
    type: 'devs-ai',
    base_url: 'https://devs.ai',
    api_key: 'sk-test1234abcd',
    is_active: true,
    workspace_id: 'ws-1',
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    request_timeout_ms: null,
  },
  {
    id: '2',
    name: 'Google Gemini',
    type: 'google-gemini',
    base_url: 'https://generativelanguage.googleapis.com',
    api_key: 'AIza-secret-key',
    is_active: false,
    workspace_id: 'ws-1',
    created_at: '2024-02-01T00:00:00Z',
    updated_at: '2024-02-01T00:00:00Z',
    request_timeout_ms: 300000,
  },
];

const paginatedProviders = {
  data: mockProviders,
  pagination: { next_cursor: null, prev_cursor: null, has_more: false, limit: 25 },
};

function renderComponent() {
  return render(
    <MantineProvider>
      <ProviderManager />
    </MantineProvider>,
  );
}

describe('ProviderManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.listProviders as ReturnType<typeof vi.fn>).mockResolvedValue(paginatedProviders);
  });

  it('renders provider list from mocked API data', async () => {
    renderComponent();
    await waitFor(() => {
      expect(api.listProviders).toHaveBeenCalledTimes(1);
    });
    expect(screen.getByText('Devs.ai Corporate')).toBeInTheDocument();
    expect(screen.getByText('Google Gemini')).toBeInTheDocument();
  });

  it('shows loading state initially', () => {
    (api.listProviders as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    const { container } = renderComponent();
    expect(container.querySelector('.mantine-Loader-root')).toBeInTheDocument();
  });

  it('shows empty state when no providers', async () => {
    (api.listProviders as ReturnType<typeof vi.fn>).mockResolvedValue(paginatedEmpty);
    renderComponent();
    expect(await screen.findByText(/No providers configured yet/)).toBeInTheDocument();
  });

  it('opens create form on "Add Provider" button click', async () => {
    (api.listProviders as ReturnType<typeof vi.fn>).mockResolvedValue(paginatedEmpty);
    renderComponent();

    const addButton = await screen.findByRole('button', { name: /Add Provider/i });
    fireEvent.click(addButton);

    await waitFor(() => {
      expect(screen.getByText('New Provider')).toBeInTheDocument();
    });
  });

  it('displays provider names in the list', async () => {
    renderComponent();
    expect(await screen.findByText('Devs.ai Corporate')).toBeInTheDocument();
    expect(screen.getByText('Google Gemini')).toBeInTheDocument();
  });

  it('shows provider type badges', async () => {
    renderComponent();
    await waitFor(() => {
      expect(screen.getByText('devs-ai')).toBeInTheDocument();
      expect(screen.getByText('google-gemini')).toBeInTheDocument();
    });
  });

  it('shows masked API key (not raw)', async () => {
    renderComponent();
    await waitFor(() => {
      expect(screen.getByText(/Key: sk-t\.\.\./)).toBeInTheDocument();
      expect(screen.getByText(/Key: AIza\.\.\./)).toBeInTheDocument();
    });
    expect(screen.queryByText(/sk-test1234abcd/)).not.toBeInTheDocument();
    expect(screen.queryByText(/AIza-secret-key/)).not.toBeInTheDocument();
  });

  it('has action buttons including delete for each provider', async () => {
    renderComponent();
    await waitFor(() => {
      expect(screen.getByText('Devs.ai Corporate')).toBeInTheDocument();
    });
    const allButtons = screen.getAllByRole('button');
    // 1 "Add Provider" button + 3 ActionIcons per provider (Test, Edit, Delete)
    expect(allButtons.length).toBe(1 + mockProviders.length * 3);
  });
});
