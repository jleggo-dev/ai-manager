import type { ReactNode } from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MantineProvider } from '@mantine/core';
import AiMatcherPage from './AiMatcherPage';
import * as api from '../services/api';

vi.mock('../services/api', () => ({
  listProviders: vi.fn(),
  listAiProfiles: vi.fn(),
  listProcessingJobs: vi.fn(),
  getProcessingJob: vi.fn(),
  listProviderAis: vi.fn(),
  listProviderModels: vi.fn(),
  runAiMatcherSlot: vi.fn(),
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

const mockProfiles = {
  data: [
    {
      id: 'prof-1',
      workspace_id: 'ws-1',
      provider_id: 'p1',
      name: 'Coach Profile',
      description: null,
      mode: 'completion',
      profile_type: 'model',
      external_ai_id: 'gpt-4o',
      runtime_options: {},
      is_active: true,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
      provider: mockProviders.data[0],
    },
  ],
  pagination: { next_cursor: null, prev_cursor: null, has_more: false, limit: 25 },
};

const mockJobs = {
  data: [],
  pagination: { next_cursor: null, prev_cursor: null, has_more: false, limit: 25 },
};

function renderPage() {
  return render(
    <MantineProvider>
      <AiMatcherPage />
    </MantineProvider>,
  );
}

describe('AiMatcherPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.listProviders as ReturnType<typeof vi.fn>).mockResolvedValue(mockProviders);
    (api.listAiProfiles as ReturnType<typeof vi.fn>).mockResolvedValue(mockProfiles);
    (api.listProcessingJobs as ReturnType<typeof vi.fn>).mockResolvedValue(mockJobs);
    (api.listProviderAis as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (api.listProviderModels as ReturnType<typeof vi.fn>).mockResolvedValue([]);
  });

  it('renders page header and initial slot after reference data loads', async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByTestId('page-header')).toHaveTextContent('AI Matcher');
      expect(screen.getByText('Slot A')).toBeInTheDocument();
      expect(screen.getByText('AI slots')).toBeInTheDocument();
    });
  });

  it('adds a second slot when Add slot is clicked', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Slot A')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Add slot/i }));

    await waitFor(() => {
      expect(screen.getByText('Slot B')).toBeInTheDocument();
    });
  });

  it('removes a slot when its remove control is clicked', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Slot A')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Add slot/i }));
    await waitFor(() => expect(screen.getByText('Slot B')).toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Remove slot B/i }));

    await waitFor(() => {
      expect(screen.queryByText('Slot B')).not.toBeInTheDocument();
      expect(screen.getByText('Slot A')).toBeInTheDocument();
    });
  });

  it('fires a configured profile slot and renders the success result', async () => {
    (api.runAiMatcherSlot as ReturnType<typeof vi.fn>).mockResolvedValue({
      slotIndex: 0,
      status: 'success',
      raw: '{"ok":true}',
      formatted: '{"ok":true}',
      formattingSteps: null,
      durationMs: 42,
      model: 'gpt-4o',
      provider: 'devs-ai',
      profileName: 'Coach Profile',
      usage: { prompt_tokens: 10, completion_tokens: 5 },
      finishReason: 'stop',
    });

    renderPage();
    await waitFor(() => expect(screen.getByText('Slot A')).toBeInTheDocument());

    // Select the existing profile in Slot A
    const profileSelect = screen.getByPlaceholderText('Select an AI profile');
    fireEvent.click(profileSelect);
    await waitFor(() => expect(screen.getByText(/Coach Profile/)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Coach Profile/));

    const promptBox = screen.getByPlaceholderText('Enter the prompt to send to all AIs...');
    fireEvent.change(promptBox, { target: { value: 'Say hello' } });

    fireEvent.click(screen.getByRole('button', { name: /Compare 1 AI/i }));

    await waitFor(() => {
      expect(api.runAiMatcherSlot).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'Say hello',
          slot: { type: 'profile', profileId: 'prof-1' },
          slotIndex: 0,
        }),
      );
      expect(screen.getByText('Results')).toBeInTheDocument();
      // Duration appears in the summary table and the result card
      expect(screen.getAllByText(/42\s*ms/).length).toBeGreaterThanOrEqual(1);
      expect(screen.getAllByText('Success').length).toBeGreaterThanOrEqual(1);
    });
  });
});
