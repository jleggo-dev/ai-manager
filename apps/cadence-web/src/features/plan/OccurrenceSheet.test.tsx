import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import type { ReactElement } from 'react';
import type { OccurrenceDetail } from '../../lib/api.ts';
import { OccurrenceSheet } from './OccurrenceSheet.tsx';

const getOccurrenceDetail = vi.fn();
const getNutritionDay = vi.fn().mockResolvedValue(null);
const getRecentMeals = vi.fn().mockResolvedValue([]);

vi.mock('../../lib/api.ts', () => ({
  getOccurrenceDetail: (...args: unknown[]) => getOccurrenceDetail(...args),
  getNutritionDay: (...args: unknown[]) => getNutritionDay(...args),
  getRecentMeals: (...args: unknown[]) => getRecentMeals(...args),
  logOccurrence: vi.fn(),
  recordWeighIn: vi.fn(),
  logMeal: vi.fn(),
  patchMeal: vi.fn(),
  getBaselineRead: vi.fn(),
  setMacroTargets: vi.fn(),
}));

vi.mock('../../components/MicButton.tsx', () => ({
  MicButton: () => <button aria-label="Dictate">mic</button>,
}));

vi.mock('../../components/Orb.tsx', () => ({
  Orb: () => <span data-testid="orb" />,
}));

const base = (partial: Partial<OccurrenceDetail>): OccurrenceDetail => ({
  occurrence_id: 'occ-1',
  activity_id: 'act-1',
  date: '2026-07-20',
  status: 'pending',
  title: 'Session',
  kind: 'user',
  ...partial,
});

function renderWithQuery(ui: ReactElement) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 0 } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('OccurrenceSheet dispatcher', () => {
  beforeEach(() => {
    getOccurrenceDetail.mockReset();
    getNutritionDay.mockResolvedValue(null);
    getRecentMeals.mockResolvedValue([]);
  });

  it('maps 404 to the "moved with your new plan" gone copy', async () => {
    getOccurrenceDetail.mockRejectedValue(Object.assign(new Error('gone'), { status: 404 }));
    renderWithQuery(<OccurrenceSheet occurrenceId="missing" onClose={() => {}} />);

    expect(await screen.findByText(/This session moved with your new plan/)).toBeInTheDocument();
  });

  it('maps non-404 fetch failures to the generic error copy', async () => {
    getOccurrenceDetail.mockRejectedValue(Object.assign(new Error('boom'), { status: 500 }));
    renderWithQuery(<OccurrenceSheet occurrenceId="bad" onClose={() => {}} />);

    expect(await screen.findByText(/Something hiccuped loading this session/)).toBeInTheDocument();
  });

  it('routes a session detail to the session log panel', async () => {
    getOccurrenceDetail.mockResolvedValue(
      base({
        title: 'Upper body',
        session: {
          blocks: [{ label: 'Main', items: [{ name: 'Press', sets: 3, reps: 8 }] }],
          note: 'Keep elbows soft.',
          generated_at: '2026-07-20T12:00:00.000Z',
          version: 1,
        },
      }),
    );
    renderWithQuery(<OccurrenceSheet occurrenceId="sess" onClose={() => {}} />);

    expect(await screen.findByText('Press')).toBeInTheDocument();
    expect(screen.getByText('3×8')).toBeInTheDocument();
    expect(screen.getByText(/How did it go/)).toBeInTheDocument();
  });

  it('routes a food system row to the meal log panel', async () => {
    getOccurrenceDetail.mockResolvedValue(base({ kind: 'system', title: 'Log your meals' }));
    renderWithQuery(<OccurrenceSheet occurrenceId="food" onClose={() => {}} />);

    expect(await screen.findByText(/What did you eat/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log this meal' })).toBeInTheDocument();
    await waitFor(() => expect(getNutritionDay).toHaveBeenCalled());
  });

  it('routes a pending weigh-in to the weigh-in panel', async () => {
    getOccurrenceDetail.mockResolvedValue(base({ kind: 'system', title: 'Weigh in', status: 'pending' }));
    renderWithQuery(<OccurrenceSheet occurrenceId="weigh" onClose={() => {}} />);

    expect(await screen.findByText(/What's the scale saying today/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('e.g. 195')).toBeInTheDocument();
  });
});
