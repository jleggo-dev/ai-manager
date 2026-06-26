import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MantineProvider } from '@mantine/core';
import HealthCheckProvidersPage from './HealthCheckProvidersPage';
import * as api from '../services/api';

vi.mock('../services/api', () => ({
  listProviders: vi.fn(),
  listHcProviderKeys: vi.fn(),
  createHcProviderKey: vi.fn(),
  updateHcProviderKey: vi.fn(),
  deleteHcProviderKey: vi.fn(),
}));

vi.mock('@mantine/notifications', () => ({
  notifications: { show: vi.fn() },
}));

vi.mock('../components/atoms/PageHeader', () => ({
  default: ({ title }: { title: string }) => <div data-testid="page-header">{title}</div>,
}));

const mockProviders = {
  data: [
    {
      id: 'p1',
      name: 'Devs.ai',
      type: 'devs-ai',
      base_url: 'https://devs.ai',
      is_active: true,
      workspace_id: 'ws-1',
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
      request_timeout_ms: null,
    },
    {
      id: 'p2',
      name: 'Gemini',
      type: 'google-gemini',
      base_url: 'https://google.com',
      is_active: true,
      workspace_id: 'ws-1',
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
      request_timeout_ms: null,
    },
  ],
  pagination: { next_cursor: null, prev_cursor: null, has_more: false, limit: 25 },
};

const mockKeys = {
  data: [
    {
      id: 'k1',
      workspace_id: 'ws-1',
      user_id: 'user-1',
      provider_id: 'p1',
      name: 'HC Key for Devs.ai',
      is_active: true,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    },
  ],
};

function renderPage() {
  return render(
    <MantineProvider>
      <HealthCheckProvidersPage onNavigate={vi.fn()} pageParams={{}} />
    </MantineProvider>,
  );
}

describe('HealthCheckProvidersPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.listProviders as ReturnType<typeof vi.fn>).mockResolvedValue(mockProviders);
    (api.listHcProviderKeys as ReturnType<typeof vi.fn>).mockResolvedValue(mockKeys);
  });

  it('renders page header', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('page-header')).toHaveTextContent('Provider Keys');
    });
  });

  it('loads and displays providers with key status', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Devs.ai')).toBeInTheDocument();
      expect(screen.getByText('Gemini')).toBeInTheDocument();
    });
    expect(screen.getByText('HC Key for Devs.ai')).toBeInTheDocument();
  });

  it('shows configure button for providers without keys', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Gemini')).toBeInTheDocument();
    });
    expect(screen.getByText('Configure Key')).toBeInTheDocument();
  });

  it('renders empty state when no providers', async () => {
    (api.listProviders as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: [],
      pagination: { next_cursor: null, prev_cursor: null, has_more: false, limit: 25 },
    });
    (api.listHcProviderKeys as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
    renderPage();
    await waitFor(() => {
      expect(screen.queryByText('Devs.ai')).not.toBeInTheDocument();
      expect(screen.queryByText('Gemini')).not.toBeInTheDocument();
    });
  });
});
