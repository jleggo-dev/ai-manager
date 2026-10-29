import { render, screen, within } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import LivenessVerdictList from './LivenessVerdictList';
import type { ProviderLivenessReport } from '../../../types/api';

const report: ProviderLivenessReport = {
  provider_id: 'prov-1',
  provider_name: 'Devs.ai v2',
  checked_at: '2026-10-28T12:00:00.000Z',
  duration_ms: 4321,
  models: [
    { model: 'gpt-4.1', verdict: 'ok', message: null, duration_ms: 812 },
    {
      model: 'claude-sonnet-5',
      verdict: 'refused',
      message: 'Model claude-sonnet-5 is not available for this request',
      duration_ms: 140,
    },
    { model: 'slow-model', verdict: 'timeout', message: 'timed out after 30000ms', duration_ms: 30001 },
    { model: 'gpt-5-mini', verdict: 'empty', message: 'answered with no text', duration_ms: 2000 },
  ],
  profiles: [
    {
      id: 'coach',
      name: 'Coach',
      primary: { model: 'claude-sonnet-5', verdict: 'refused' },
      failover: { model: 'claude-sonnet-5', verdict: 'refused' },
      dead: true,
    },
    {
      id: 'broker',
      name: 'Broker',
      primary: { model: 'gpt-4.1', verdict: 'ok' },
      failover: { model: 'slow-model', verdict: 'timeout' },
      dead: true,
    },
    { id: 'judge', name: 'Judge', primary: { model: 'gpt-4.1', verdict: 'ok' }, failover: null, dead: false },
  ],
};

function renderList(r: ProviderLivenessReport = report) {
  return render(
    <MantineProvider>
      <LivenessVerdictList report={r} />
    </MantineProvider>,
  );
}

describe('LivenessVerdictList', () => {
  it("lists each model with a plain verdict, keeping the provider's words for a refusal", () => {
    renderList();
    const ok = screen.getByTestId('liveness-model-gpt-4.1');
    expect(within(ok).getByText('answers')).toBeInTheDocument();

    const refused = screen.getByTestId('liveness-model-claude-sonnet-5');
    expect(
      within(refused).getByText('refused: Model claude-sonnet-5 is not available for this request'),
    ).toBeInTheDocument();

    expect(within(screen.getByTestId('liveness-model-slow-model')).getByText('timed out')).toBeInTheDocument();
    expect(
      within(screen.getByTestId('liveness-model-gpt-5-mini')).getByText('answered with no text'),
    ).toBeInTheDocument();
  });

  it('marks profiles whose primary or failover does not answer, and leaves healthy ones alone', () => {
    renderList();
    expect(screen.getByTestId('liveness-profile-coach')).toHaveAttribute('data-dead', 'true');
    expect(screen.getByTestId('liveness-profile-broker')).toHaveAttribute('data-dead', 'true');
    expect(screen.getByTestId('liveness-profile-judge')).toHaveAttribute('data-dead', 'false');
    expect(screen.getAllByLabelText('does not answer')).toHaveLength(2);
    expect(screen.getByText(/2 do not answer/)).toBeInTheDocument();
  });

  it('shows the primary and failover pointers on a profile', () => {
    renderList();
    const broker = screen.getByTestId('liveness-profile-broker');
    expect(within(broker).getByText('primary')).toBeInTheDocument();
    expect(within(broker).getByText('failover')).toBeInTheDocument();
    expect(within(broker).getByText('slow-model')).toBeInTheDocument();
  });

  it('says so when nothing points at the provider', () => {
    renderList({ ...report, models: [], profiles: [] });
    expect(screen.getByText(/nothing to check/)).toBeInTheDocument();
    expect(screen.queryByTestId('liveness-models')).not.toBeInTheDocument();
  });
});
