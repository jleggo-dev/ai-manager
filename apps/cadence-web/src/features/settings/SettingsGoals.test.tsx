import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const api = vi.hoisted(() => ({ getReview: vi.fn() }));
vi.mock('../../lib/api.ts', () => api);

const goalApi = vi.hoisted(() => ({ renameGoal: vi.fn(), retireGoal: vi.fn(), restoreGoal: vi.fn() }));
vi.mock('./goalApi.shim.ts', () => goalApi);

const { SettingsGoals } = await import('./SettingsGoals.tsx');

const goal = (over: Record<string, unknown> = {}) => ({
  goal_id: 'g1',
  title: 'Reach a healthy weight',
  area: 'nourishment',
  type: 'target',
  measure: { metric: 'weight', target: 78, unit: 'kg' },
  timeframe: {},
  status: 'committed',
  linked_equipment: [],
  source: 'manual',
  ...over,
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function openMenu(title = 'Reach a healthy weight') {
  await screen.findByText(title);
  fireEvent.click(screen.getByLabelText(`Options for ${title}`));
}

describe('SettingsGoals', () => {
  it('shows only confirmed/committed goals as plan-card rows with an area dot and mono meta line', async () => {
    api.getReview.mockResolvedValueOnce({
      goals: [goal(), goal({ goal_id: 'g2', title: 'Still captured', status: 'captured' })],
    });
    render(<SettingsGoals onBack={() => {}} />);

    expect(await screen.findByText('Reach a healthy weight')).toBeInTheDocument();
    expect(screen.queryByText('Still captured')).not.toBeInTheDocument();
    expect(screen.getByText('TREND · TARGET 78 KG · NO DEADLINE')).toBeInTheDocument();
  });

  it('renames a goal through the seam function', async () => {
    api.getReview.mockResolvedValueOnce({ goals: [goal()] });
    goalApi.renameGoal.mockResolvedValueOnce(true);
    render(<SettingsGoals onBack={() => {}} />);
    await openMenu();

    fireEvent.click(screen.getByText('Rename'));
    const input = screen.getByLabelText('Rename Reach a healthy weight');
    fireEvent.change(input, { target: { value: 'Get to goal weight' } });
    fireEvent.click(screen.getByText('Save'));

    await waitFor(() => expect(goalApi.renameGoal).toHaveBeenCalledWith('g1', 'Get to goal weight'));
    expect(await screen.findByText('Get to goal weight')).toBeInTheDocument();
  });

  it('shows the retire confirm copy with the goal name, and "Keep it" calls nothing', async () => {
    api.getReview.mockResolvedValueOnce({ goals: [goal()] });
    render(<SettingsGoals onBack={() => {}} />);
    await openMenu();

    fireEvent.click(screen.getByText('Retire…'));
    expect(screen.getByText('Retire "Reach a healthy weight"?')).toBeInTheDocument();
    expect(
      screen.getByText(/It stops shaping your weeks from Monday\. Everything it built stays in Progress\./),
    ).toBeInTheDocument();
    expect(screen.getByText(/tell Cadence and she'll bring it back/)).toBeInTheDocument();

    fireEvent.click(screen.getByText('Keep it'));
    expect(goalApi.retireGoal).not.toHaveBeenCalled();
    expect(screen.queryByText('Retire "Reach a healthy weight"?')).not.toBeInTheDocument();
    expect(screen.getByText('Reach a healthy weight')).toBeInTheDocument();
  });

  it('"Retire it" calls retireGoal and drops the row on success', async () => {
    api.getReview.mockResolvedValueOnce({ goals: [goal()] });
    goalApi.retireGoal.mockResolvedValueOnce(true);
    render(<SettingsGoals onBack={() => {}} />);
    await openMenu();
    fireEvent.click(screen.getByText('Retire…'));
    fireEvent.click(screen.getByText('Retire it'));

    await waitFor(() => expect(goalApi.retireGoal).toHaveBeenCalledWith('g1'));
    expect(screen.queryByText('Reach a healthy weight')).not.toBeInTheDocument();
  });

  it('the coach door hands onCoach a note about wanting a goal to mean something different', async () => {
    api.getReview.mockResolvedValueOnce({ goals: [goal()] });
    const onCoach = vi.fn();
    render(<SettingsGoals onBack={() => {}} onCoach={onCoach} />);

    fireEvent.click(await screen.findByText('Want a goal to mean something different?'));
    expect(onCoach).toHaveBeenCalledTimes(1);
    expect(onCoach.mock.calls[0][0]).toMatch(/mean something different/);
  });
});
