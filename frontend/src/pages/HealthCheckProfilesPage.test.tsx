import type { ReactNode } from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MantineProvider } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import HealthCheckProfilesPage from './HealthCheckProfilesPage';
import * as api from '../services/api';

vi.mock('../services/api', () => ({
  listHcProfiles: vi.fn(),
  listProviders: vi.fn(),
  listHcProviderKeys: vi.fn(),
  listProviderAis: vi.fn(),
  listProviderModels: vi.fn(),
  createHcProfile: vi.fn(),
  updateHcProfile: vi.fn(),
  deleteHcProfile: vi.fn(),
}));

vi.mock('@mantine/notifications', () => ({
  notifications: { show: vi.fn() },
}));

vi.mock('../components/atoms/PageHeader', () => ({
  default: ({ title, children }: { title: string; children?: ReactNode }) => (
    <div data-testid="page-header">
      <span>{title}</span>
      {children}
    </div>
  ),
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
      name: 'HC Key',
      is_active: true,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    },
  ],
};

const mockProfiles = {
  data: [
    {
      id: 'prof-1',
      workspace_id: 'ws-1',
      provider_id: 'p1',
      hc_provider_key_id: 'k1',
      external_ai_id: 'agent-1',
      name: 'Primary Check',
      description: null,
      mode: 'completion',
      profile_type: 'agent',
      runtime_options: {},
      is_active: true,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
      provider: mockProviders.data[0],
    },
  ],
};

function renderPage() {
  return render(
    <MantineProvider>
      <HealthCheckProfilesPage onNavigate={vi.fn()} pageParams={{}} />
    </MantineProvider>,
  );
}

describe('HealthCheckProfilesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.listHcProfiles as ReturnType<typeof vi.fn>).mockResolvedValue(mockProfiles);
    (api.listProviders as ReturnType<typeof vi.fn>).mockResolvedValue(mockProviders);
    (api.listHcProviderKeys as ReturnType<typeof vi.fn>).mockResolvedValue(mockKeys);
    (api.listProviderAis as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (api.listProviderModels as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  it('renders page header and loaded profiles', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('page-header')).toHaveTextContent('Health Check Profiles');
      expect(screen.getByText('Primary Check')).toBeInTheDocument();
      expect(screen.getByText('agent-1')).toBeInTheDocument();
    });
  });

  it('shows empty state when there are no profiles', async () => {
    (api.listHcProfiles as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/No health check profiles yet/i)).toBeInTheDocument();
    });
  });

  it('opens the create modal from New Profile', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('New Profile')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('New Profile'));
    await waitFor(() => {
      expect(screen.getByText('New Health Check Profile')).toBeInTheDocument();
    });
  });

  it('deletes a profile after confirmation', async () => {
    (api.deleteHcProfile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (api.listHcProfiles as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(mockProfiles)
      .mockResolvedValueOnce({ data: [] });

    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Primary Check')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByLabelText('Delete'));
    await waitFor(() => {
      expect(screen.getByText('Delete Health Check Profile')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Delete Profile & Health Check'));
    await waitFor(() => {
      expect(api.deleteHcProfile).toHaveBeenCalledWith('prof-1');
      expect(notifications.show).toHaveBeenCalledWith(expect.objectContaining({ title: 'Deleted', color: 'orange' }));
    });
  });
});
