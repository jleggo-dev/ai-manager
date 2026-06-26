import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import HealthDashboardPage from './HealthDashboardPage';
import * as api from '../services/api';

vi.mock('../services/api', () => ({
  getHcDashboard: vi.fn(),
  getWidgetHcDashboard: vi.fn(),
  getHcUptimeHistory: vi.fn(),
  getWidgetHcUptimeHistory: vi.fn(),
  runHcCheck: vi.fn(),
  runWidgetHcCheck: vi.fn(),
}));

vi.mock('@mantine/notifications', () => ({
  notifications: { show: vi.fn() },
}));

vi.mock('../components/atoms/PageHeader', () => ({
  default: ({ title }: { title: string }) => <div data-testid="page-header">{title}</div>,
}));

const mockDashboard = {
  data: [
    {
      id: 'hc-1',
      name: 'Production AI Check',
      profileName: 'GPT-4 Health',
      providerName: 'OpenAI',
      cadenceMinutes: 15,
      outageCadenceMinutes: 2,
      isActive: true,
      lastRunAt: new Date().toISOString(),
      semaphore: 'green' as const,
      lastRun: {
        id: 'run-1',
        health_check_id: 'hc-1',
        workspace_id: 'ws-1',
        status: 'pass' as const,
        response_time_ms: 450,
        error_message: null,
        raw_response: 'Hello!',
        created_at: new Date().toISOString(),
      },
      recentRuns: [],
      activeIncident: null,
    },
    {
      id: 'hc-2',
      name: 'Backup AI Check',
      profileName: 'Gemini Health',
      providerName: 'Google',
      cadenceMinutes: 60,
      outageCadenceMinutes: 2,
      isActive: true,
      lastRunAt: new Date(Date.now() - 3600000).toISOString(),
      semaphore: 'red' as const,
      lastRun: {
        id: 'run-2',
        health_check_id: 'hc-2',
        workspace_id: 'ws-1',
        status: 'fail' as const,
        response_time_ms: null,
        error_message: 'Connection refused',
        raw_response: null,
        created_at: new Date(Date.now() - 3600000).toISOString(),
      },
      recentRuns: [],
      activeIncident: {
        id: 'inc-1',
        health_check_id: 'hc-2',
        workspace_id: 'ws-1',
        started_at: new Date(Date.now() - 7200000).toISOString(),
        resolved_at: null,
        duration_seconds: null,
        failed_run_count: 5,
        last_error: 'Connection refused',
        created_at: new Date(Date.now() - 7200000).toISOString(),
      },
    },
  ],
};

function renderPage() {
  return render(
    <MantineProvider>
      <HealthDashboardPage onNavigate={vi.fn()} pageParams={{}} />
    </MantineProvider>,
  );
}

describe('HealthDashboardPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.getHcDashboard as ReturnType<typeof vi.fn>).mockResolvedValue(mockDashboard);
    (api.getWidgetHcDashboard as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
    (api.getHcUptimeHistory as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
    (api.getWidgetHcUptimeHistory as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
  });

  it('renders loading state initially', () => {
    (api.getHcDashboard as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    (api.getWidgetHcDashboard as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));
    const { container } = renderPage();
    expect(container.querySelector('.mantine-Loader-root')).toBeInTheDocument();
  });

  it('renders dashboard cards after loading', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Detail')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Detail'));
    await waitFor(() => {
      expect(screen.getByText('Production AI Check')).toBeInTheDocument();
    });
    expect(screen.getByText('Backup AI Check')).toBeInTheDocument();
  });

  it('shows correct semaphore colors', async () => {
    const { container } = renderPage();
    await waitFor(() => {
      expect(screen.getByText('Detail')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Detail'));
    await waitFor(() => {
      expect(screen.getByText('Production AI Check')).toBeInTheDocument();
    });

    const allDivs = container.querySelectorAll('div');
    const semaphoreDots = Array.from(allDivs).filter((d) => d.style.borderRadius === '50%');
    expect(semaphoreDots.length).toBeGreaterThanOrEqual(2);
    expect(semaphoreDots[0]).toHaveStyle({ backgroundColor: '#40c057' });
    expect(semaphoreDots[1]).toHaveStyle({ backgroundColor: '#fa5252' });
  });

  it('shows active incident alert for failing checks', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Detail')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Detail'));
    await waitFor(() => {
      expect(screen.getByText('Backup AI Check')).toBeInTheDocument();
    });
    expect(screen.getByText(/5 consecutive failures/)).toBeInTheDocument();
  });

  it('shows accelerated cadence for checks with active incidents', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Detail')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Detail'));
    await waitFor(() => {
      expect(screen.getByText('Backup AI Check')).toBeInTheDocument();
    });
    expect(screen.getByText('Every 2 min (accelerated)')).toBeInTheDocument();
  });

  it('shows normal cadence for healthy checks', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Detail')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Detail'));
    await waitFor(() => {
      expect(screen.getByText('Production AI Check')).toBeInTheDocument();
    });
    expect(screen.getByText('Every 15 min')).toBeInTheDocument();
  });

  it('renders empty state when no checks', async () => {
    (api.getHcDashboard as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
    (api.getWidgetHcDashboard as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
    renderPage();
    expect(await screen.findByText(/No health checks configured/)).toBeInTheDocument();
  });

  it('Run Now button calls API', async () => {
    (api.runHcCheck as ReturnType<typeof vi.fn>).mockResolvedValue({});
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Detail')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('Detail'));
    await waitFor(() => {
      expect(screen.getByText('Production AI Check')).toBeInTheDocument();
    });

    const runButtons = screen.getAllByLabelText('Run now');
    const firstButton = runButtons[0];
    if (!firstButton) throw new Error('Run now button not found');
    fireEvent.click(firstButton);

    await waitFor(() => {
      expect(api.runHcCheck).toHaveBeenCalledWith('hc-1');
    });
  });
});
