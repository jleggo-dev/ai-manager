import { render, screen, waitFor } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import ModelVerdict from './ModelVerdict';
import * as api from '../../services/api';
import { QueryWrapper } from '../../test/query-wrapper';
import type { ProviderLivenessReport } from '../../types/api';

vi.mock('../../services/api', () => ({
  getProviderLiveness: vi.fn(),
}));

const report: ProviderLivenessReport = {
  provider_id: 'prov-1',
  provider_name: 'Devs.ai v2',
  checked_at: '2026-10-28T12:00:00.000Z',
  duration_ms: 100,
  models: [
    { model: 'gpt-4.1', verdict: 'ok', message: null, duration_ms: 50 },
    {
      model: 'claude-sonnet-5',
      verdict: 'refused',
      message: 'Model claude-sonnet-5 is not available for this request',
      duration_ms: 20,
    },
  ],
  profiles: [],
};

function renderVerdict(providerId: string | null, model: string) {
  return render(
    <QueryWrapper>
      <MantineProvider>
        <ModelVerdict providerId={providerId} model={model} />
      </MantineProvider>
    </QueryWrapper>,
  );
}

describe('ModelVerdict', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.getProviderLiveness as ReturnType<typeof vi.fn>).mockResolvedValue(report);
  });

  it('shows "answers" beside a model that answered in the last check', async () => {
    renderVerdict('prov-1', 'gpt-4.1');
    const el = await screen.findByTestId('model-verdict');
    expect(el).toHaveAttribute('data-verdict', 'ok');
    expect(screen.getByText('answers')).toBeInTheDocument();
    expect(api.getProviderLiveness).toHaveBeenCalledWith('prov-1');
  });

  it("shows the refusal in the provider's words beside a dead pointer", async () => {
    renderVerdict('prov-1', 'claude-sonnet-5');
    const el = await screen.findByTestId('model-verdict');
    expect(el).toHaveAttribute('data-verdict', 'refused');
    expect(screen.getByText(/refused: Model claude-sonnet-5 is not available for this request/)).toBeInTheDocument();
  });

  it('says a model was not in the last check instead of guessing', async () => {
    renderVerdict('prov-1', 'brand-new-model');
    const el = await screen.findByTestId('model-verdict');
    expect(el).toHaveAttribute('data-verdict', 'unchecked');
    expect(screen.getByText(/Not in the last check/)).toBeInTheDocument();
  });

  it('renders nothing when no check has run yet', async () => {
    (api.getProviderLiveness as ReturnType<typeof vi.fn>).mockResolvedValue(null);
    renderVerdict('prov-1', 'gpt-4.1');
    await waitFor(() => expect(api.getProviderLiveness).toHaveBeenCalled());
    expect(screen.queryByTestId('model-verdict')).not.toBeInTheDocument();
  });

  it('renders nothing and fetches nothing without a provider or model', () => {
    renderVerdict(null, 'gpt-4.1');
    renderVerdict('prov-1', '');
    expect(screen.queryByTestId('model-verdict')).not.toBeInTheDocument();
  });
});
