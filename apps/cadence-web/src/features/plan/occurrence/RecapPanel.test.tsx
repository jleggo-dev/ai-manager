/**
 * A23 §2b — the weekly check-in panel. What these pin:
 *   • the FIGURES are the check-in — they render whether or not the narration arrived;
 *   • the scale comes first when it is still owed, so Sunday is one moment and not two;
 *   • "days we could count" is stated next to the average, so nobody multiplies the wrong pair;
 *   • a thin weight series is labelled as thin rather than presented as a verdict.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

vi.mock('../../../lib/query/index.ts', () => ({
  useInvalidateNutritionDay: () => vi.fn(),
  localTodayIso: () => '2026-08-22',
}));

const api = vi.hoisted(() => ({
  fetchWeeklyRecap: vi.fn(),
  setOccurrence: vi.fn(async () => undefined),
  recordWeighIn: vi.fn(async () => ({ weight_kg: 88 })),
}));
vi.mock('../../../lib/api.ts', () => api);

const { RecapPanel } = await import('./RecapPanel.tsx');

const detail = {
  occurrence_id: 'occ-checkin',
  title: 'Weekly check-in',
  kind: 'system',
  status: 'pending',
} as unknown as Parameters<typeof RecapPanel>[0]['detail'];

function recap(over: Record<string, unknown> = {}) {
  return {
    period: { from: '2026-08-16', to: '2026-08-22' },
    consistency: { kept: 5, window: 7 },
    rolling: { kept: 19, window: 28 },
    goals: [],
    nutrition: {
      days_logged: 4,
      days_counted: 3,
      days_in_window: 7,
      avg_kcal: 2000,
      target_kcal: 2100,
      avg_protein_g: 120,
    },
    weight: {
      actual_kg_per_week: -0.4,
      safe_kg_per_week: 0.66,
      pace: 'on_track',
      confidence: 'medium',
      trend_kg: 88.2,
    },
    episodes: [],
    note: 'Five of seven days — that is a rhythm. How did the week actually feel?',
    weigh_in: null,
    ...over,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('RecapPanel', () => {
  it('shows the week and the coach’s read of it', async () => {
    api.fetchWeeklyRecap.mockResolvedValueOnce(recap());
    render(<RecapPanel detail={detail} setDetail={() => {}} />);

    expect(await screen.findByText('5 of 7')).toBeInTheDocument();
    expect(screen.getByText('days you showed up')).toBeInTheDocument();
    expect(screen.getByText(/Five of seven days/)).toBeInTheDocument();
    expect(screen.getByText(/19 days you showed up/)).toBeInTheDocument();
  });

  /** The rule the photo path learned the hard way: a failed narration is not an empty week. */
  it('still shows the figures when the narration did not arrive', async () => {
    api.fetchWeeklyRecap.mockResolvedValueOnce(recap({ note: '' }));
    render(<RecapPanel detail={detail} setDetail={() => {}} />);

    expect(await screen.findByText('5 of 7')).toBeInTheDocument();
    expect(screen.getByText(/how did it actually feel/i)).toBeInTheDocument();
  });

  it('names the days the average is over, so nobody multiplies the wrong pair', async () => {
    api.fetchWeeklyRecap.mockResolvedValueOnce(recap());
    render(<RecapPanel detail={detail} setDetail={() => {}} />);

    expect(await screen.findByText('4 of 7')).toBeInTheDocument(); // days logged
    expect(screen.getByText(/3 days we could count/)).toBeInTheDocument();
    expect(screen.getByText(/aiming 2100/)).toBeInTheDocument();
  });

  it('leads with the scale when the week’s weigh-in is still open', async () => {
    api.fetchWeeklyRecap.mockResolvedValueOnce(
      recap({ weigh_in: { occurrence_id: 'occ-weigh', date: '2026-08-21', pending: true } }),
    );
    render(<RecapPanel detail={detail} setDetail={() => {}} />);

    expect(await screen.findByText('FIRST, THE SCALE')).toBeInTheDocument();
    expect(screen.getByText("What's the scale saying today?")).toBeInTheDocument();
  });

  it('does not ask for the scale again once it is answered', async () => {
    api.fetchWeeklyRecap.mockResolvedValueOnce(
      recap({ weigh_in: { occurrence_id: 'occ-weigh', date: '2026-08-21', pending: false } }),
    );
    render(<RecapPanel detail={detail} setDetail={() => {}} />);

    await screen.findByText('5 of 7');
    expect(screen.queryByText('FIRST, THE SCALE')).not.toBeInTheDocument();
  });

  it('calls a thin series thin instead of presenting it as a verdict', async () => {
    api.fetchWeeklyRecap.mockResolvedValueOnce(
      recap({
        weight: { actual_kg_per_week: -0.9, safe_kg_per_week: 0.66, pace: 'too_fast', confidence: 'low', trend_kg: 88 },
      }),
    );
    render(<RecapPanel detail={detail} setDetail={() => {}} />);

    expect(await screen.findByText(/early days for this one/)).toBeInTheDocument();
  });

  it('marks the check-in done on the server, not just on screen', async () => {
    api.fetchWeeklyRecap.mockResolvedValueOnce(recap());
    const setDetail = vi.fn();
    render(<RecapPanel detail={detail} setDetail={setDetail} />);

    (await screen.findByRole('button', { name: /Read it/ })).click();
    await waitFor(() => expect(api.setOccurrence).toHaveBeenCalledWith('occ-checkin', 'done'));
    expect(setDetail).toHaveBeenCalled();
  });

  it('says so plainly when the week cannot be put together', async () => {
    api.fetchWeeklyRecap.mockRejectedValueOnce(new Error('500'));
    render(<RecapPanel detail={detail} setDetail={() => {}} />);

    expect(await screen.findByText(/couldn't put your week together/i)).toBeInTheDocument();
  });
});
