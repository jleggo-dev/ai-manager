import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MantineProvider } from '@mantine/core';
import HealthCheckWidgetPage from './HealthCheckWidgetPage';
import * as api from '../services/api';

vi.mock('../services/api', () => ({
  listWidgetHcChecks: vi.fn(),
  createWidgetHcCheck: vi.fn(),
  updateWidgetHcCheck: vi.fn(),
  deleteWidgetHcCheck: vi.fn(),
  runWidgetHcCheck: vi.fn(),
  listWidgetHcRuns: vi.fn(),
  listWidgetHcIncidents: vi.fn(),
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

const mockChecks = {
  data: [
    {
      id: 'wchk-1',
      workspace_id: 'ws-1',
      name: 'Marketing Widget',
      url: 'https://www.example.com/marketing',
      test_message: 'Hello',
      cadence_minutes: 15,
      outage_cadence_minutes: 2,
      is_active: true,
      last_run_at: new Date().toISOString(),
      max_retries: 1,
      launcher_selector: '#root [class*="Button"]',
      iframe_selector: '[class*="Iframe"]',
      input_selector: '#chat-input',
      send_selector: 'button[type="submit"]',
      response_selector: '[class*="ChatBubble"]',
      error_patterns: ['Application error'],
      page_load_timeout_ms: 15000,
      response_timeout_ms: 45000,
      capture_screenshot: false,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    },
  ],
};

function renderPage() {
  return render(
    <MantineProvider>
      <HealthCheckWidgetPage onNavigate={vi.fn()} pageParams={{}} />
    </MantineProvider>,
  );
}

describe('HealthCheckWidgetPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.listWidgetHcChecks as ReturnType<typeof vi.fn>).mockResolvedValue(mockChecks);
    (api.runWidgetHcCheck as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: 'run-1',
      status: 'pass',
      response_time_ms: 200,
    });
    (api.listWidgetHcRuns as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
    (api.listWidgetHcIncidents as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
  });

  it('renders page header', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('page-header')).toHaveTextContent('Widget Health');
    });
  });

  it('loads and displays widget checks', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Marketing Widget')).toBeInTheDocument();
    });
  });

  it('shows URL domain as link', async () => {
    renderPage();
    await waitFor(() => {
      const link = screen.getByText('www.example.com');
      expect(link).toBeInTheDocument();
      expect(link.closest('a')).toHaveAttribute('href', 'https://www.example.com/marketing');
    });
  });

  it('shows cadence and active status', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('15 min')).toBeInTheDocument();
      expect(screen.getAllByText('Enabled').length).toBeGreaterThanOrEqual(1);
    });
  });

  it('renders empty state when no checks', async () => {
    (api.listWidgetHcChecks as ReturnType<typeof vi.fn>).mockResolvedValue({ data: [] });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('No widget health checks configured yet.')).toBeInTheDocument();
    });
  });

  it('Run Now button calls the correct API', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Marketing Widget')).toBeInTheDocument();
    });
    const runBtn = screen.getByLabelText('Run Now');
    fireEvent.click(runBtn);
    await waitFor(() => {
      expect(api.runWidgetHcCheck).toHaveBeenCalledWith('wchk-1');
    });
  });

  it('opens create modal on button click', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Marketing Widget')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('New Widget Check'));
    await waitFor(() => {
      expect(screen.getByText('Cadence (minutes)')).toBeInTheDocument();
    });
  });

  it('shows outage cadence field in create modal', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Marketing Widget')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText('New Widget Check'));
    await waitFor(() => {
      expect(screen.getByText('Outage Cadence (minutes)')).toBeInTheDocument();
    });
  });

  it('edit modal populates outage cadence value from existing check', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByText('Marketing Widget')).toBeInTheDocument();
    });
    const editBtn = screen.getByLabelText('Edit');
    fireEvent.click(editBtn);
    await waitFor(() => {
      expect(screen.getByText('Outage Cadence (minutes)')).toBeInTheDocument();
    });
    const input = screen.getByLabelText('Outage Cadence (minutes)');
    expect(input).toHaveValue('2');
  });
});
