/**
 * A23 §2c — weigh-in cadence. What these pin:
 *   • weekly is the DEFAULT and nothing about daily is pushed;
 *   • the promise that makes daily safe to offer is stated on screen, not just in a design doc;
 *   • daily opens a place to enter a number, weekly does not;
 *   • "no weigh-in on your plan" is answered as a fact, not swallowed as a failure.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { renderWithQuery } from '../../test/withQuery.tsx';

const api = vi.hoisted(() => ({
  getReview: vi.fn(),
  updateBaseline: vi.fn(async () => undefined),
  recordWeighInToday: vi.fn(async () => ({ weight_kg: 88 })),
}));
vi.mock('../../lib/api.ts', () => api);

const { WeighInSettings } = await import('./WeighInSettings.tsx');

const review = (over: Record<string, unknown> = {}) => ({ baseline: { weight_unit: 'lbs', ...over } });

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function openPanel() {
  renderWithQuery(<WeighInSettings />);
  fireEvent.click(await screen.findByText('Weigh-ins'));
}

describe('WeighInSettings', () => {
  it('defaults to weekly when nothing has been chosen', async () => {
    api.getReview.mockResolvedValueOnce(review());
    renderWithQuery(<WeighInSettings />);
    expect(await screen.findByText('Once a week')).toBeInTheDocument();
  });

  it('states the promise that makes daily safe to offer', async () => {
    api.getReview.mockResolvedValueOnce(review());
    await openPanel();
    expect(screen.getByText(/never the morning's number on its own/)).toBeInTheDocument();
    // And it does not imply weekly is the lesser choice.
    expect(screen.getByText(/perfectly good way to do this/)).toBeInTheDocument();
  });

  it('offers somewhere to enter a number only once daily is chosen', async () => {
    api.getReview.mockResolvedValueOnce(review());
    await openPanel();
    expect(screen.queryByLabelText("Today's weight")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Daily' }));
    await waitFor(() => expect(api.updateBaseline).toHaveBeenCalledWith({ weigh_in_cadence: 'daily' }));
    expect(screen.getByLabelText("Today's weight")).toBeInTheDocument();
  });

  it('sends the reading in the unit the user keeps their weight in', async () => {
    api.getReview.mockResolvedValueOnce(review({ weigh_in_cadence: 'daily', weight_unit: 'kg' }));
    await openPanel();

    fireEvent.change(screen.getByLabelText("Today's weight"), { target: { value: '88.4' } });
    fireEvent.click(screen.getByRole('button', { name: /Add it to the trend/ }));

    await waitFor(() => expect(api.recordWeighInToday).toHaveBeenCalledWith(88.4, 'kg'));
    expect(await screen.findByText(/feeds the trend/)).toBeInTheDocument();
  });

  /** 404 here means something true about their plan — say it, don't render "something went wrong". */
  it('explains a missing weigh-in instead of calling it an error', async () => {
    api.getReview.mockResolvedValueOnce(review({ weigh_in_cadence: 'daily' }));
    api.recordWeighInToday.mockRejectedValueOnce(Object.assign(new Error('404'), { status: 404 }));
    await openPanel();

    fireEvent.change(screen.getByLabelText("Today's weight"), { target: { value: '195' } });
    fireEvent.click(screen.getByRole('button', { name: /Add it to the trend/ }));

    expect(await screen.findByText(/no weigh-in on your plan yet/)).toBeInTheDocument();
  });

  it('does not send a junk reading', async () => {
    api.getReview.mockResolvedValueOnce(review({ weigh_in_cadence: 'daily' }));
    await openPanel();
    // The button stays disabled with nothing typed.
    expect(screen.getByRole('button', { name: /Add it to the trend/ })).toBeDisabled();
  });
});
