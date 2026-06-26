import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MantineProvider } from '@mantine/core';
import HealthCheckConfigPage from './HealthCheckConfigPage';
import * as api from '../services/api';

vi.mock('../services/api', () => ({
  listHcChecks: vi.fn(),
  listHcProfiles: vi.fn(),
  createHcCheck: vi.fn(),
  updateHcCheck: vi.fn(),
  deleteHcCheck: vi.fn(),
  runHcCheck: vi.fn(),
  listHcRuns: vi.fn(),
  listHcIncidents: vi.fn(),
  backfillHcChecks: vi.fn(),
}));

vi.mock('@mantine/notifications', () => ({
  notifications: { show: vi.fn() },
}));

vi.mock('../components/atoms/PageHeader', () => ({
  default: ({ title, children }: { title: string; children?: React.ReactNode }) => (
    <div data-testid="page-header">
      {title}
      {children}
    </div>
  ),
}));

const mockProfiles = {
  data: [
    {
      id: 'prof-1',
      name: 'Test Profile',
      provider_id: 'p1',
      hc_provider_key_id: 'k1',
      external_ai_id: 'model-1',
      mode: 'completion',
      profile_type: 'model',
      runtime_options: {},
      is_active: true,
      workspace_id: 'ws-1',
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    },
  ],
};

const mockChecks = {
  data: [
    {
      id: 'chk-1',
      workspace_id: 'ws-1',
      health_check_profile_id: 'prof-1',
      name: 'Prod Health Check',
      test_message: 'ping',
      cadence_minutes: 15,
      outage_cadence_minutes: 2,
      is_active: true,
      last_run_at: new Date().toISOString(),
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
      health_check_profile: mockProfiles.data[0],
    },
  ],
};

function renderPage() {
  return render(
    <MantineProvider>
      <HealthCheckConfigPage onNavigate={vi.fn()} pageParams={{}} />
    </MantineProvider>,
  );
}

describe('HealthCheckConfigPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.backfillHcChecks as ReturnType<typeof vi.fn>).mockResolvedValue({ success: true, created: 0 });
    (api.listHcChecks as ReturnType<typeof vi.fn>).mockResolvedValue(mockChecks);
    (api.listHcProfiles as ReturnType<typeof vi.fn>).mockResolvedValue(mockProfiles);
    (api.listHcRuns as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
    (api.listHcIncidents as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
    (api.runHcCheck as ReturnType<typeof vi.fn>).mockResolvedValue({ status: 'pass', response_time_ms: 120 });
  });

  it('renders page header', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('page-header')).toHaveTextContent('API Health');
    });
  });

  it('loads and displays health checks', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Prod Health Check')).toBeInTheDocument();
    });
  });

  it('shows cadence and status', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('15 min')).toBeInTheDocument();
      expect(screen.getAllByText('Enabled').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders empty state when no checks', async () => {
    (api.listHcChecks as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('No health checks yet. Create a profile to get started.')).toBeInTheDocument();
    });
  });

  it('does not show a New Health Check button (checks are auto-created from profiles)', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Prod Health Check')).toBeInTheDocument();
    });
    expect(screen.queryByText('New Health Check')).not.toBeInTheDocument();
  });

  it('edit modal populates outage cadence value from existing check', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Prod Health Check')).toBeInTheDocument();
    });
    const editBtn = screen.getByLabelText('Edit');
    fireEvent.click(editBtn);
    await waitFor(() => {
      expect(screen.getByText('Outage Cadence (minutes)')).toBeInTheDocument();
    });
    const input = screen.getByLabelText('Outage Cadence (minutes)');
    expect(input).toHaveValue('2');
  });

  it('Run Now calls the API', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Prod Health Check')).toBeInTheDocument();
    });
    const runBtn = screen.getByLabelText('Run Now');
    fireEvent.click(runBtn);
    await waitFor(() => {
      expect(api.runHcCheck).toHaveBeenCalledWith('chk-1');
    });
  });
});
