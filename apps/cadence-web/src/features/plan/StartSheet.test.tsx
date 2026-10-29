/**
 * The start sheet's answers when the detail does not come: `gone` (a replan), `unreachable` (the
 * server tried and could not reach the coach — 503 `coach_unreachable`) and the plain `error`.
 * The unreachable state is the 2026-10-27/28 outage made visible: one honest sentence and a
 * Try-again that re-fetches in place, where before every session said "close and tap it again"
 * and tapping again did nothing. The retry tap is a button, so it gets its table.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { renderWithQuery } from '../../test/withQuery.tsx';

const getOccurrenceDetail = vi.fn();
vi.mock('../../lib/api.ts', () => ({
  getOccurrenceDetail: (...a: unknown[]) => getOccurrenceDetail(...a),
  getSessionInsight: vi.fn(async () => null),
  setOccurrence: vi.fn(),
  logOccurrence: vi.fn(),
  // Read by a step tool's unit label once the session renders; not part of this fetch.
  getUnits: vi.fn(async () => null),
}));
// The watch row is a native chain (paired watch, WorkoutKit) — nothing to do with the fetch.
vi.mock('./occurrence/WatchHandoffRow.tsx', () => ({ WatchHandoffRow: () => null }));

const { StartSheet } = await import('./StartSheet.tsx');

const detail = () => ({
  occurrence_id: 'o1',
  activity_id: 'a1',
  date: '2026-10-29',
  status: 'pending' as const,
  title: 'Upper body',
  kind: 'user' as const,
  session: {
    version: 1,
    generated_at: '2026-10-28T00:00:00.000Z',
    note: 'ok',
    blocks: [{ label: 'Main', items: [{ name: 'Press', tool: 'reps', sets: 3, reps: 10 }] }],
  },
});

const unreachable = () => Object.assign(new Error('detail failed: 503'), { status: 503, code: 'coach_unreachable' });

// A rendered session reads the unit preference from the shared cache, so it needs a client.
function mount() {
  return renderWithQuery(<StartSheet occurrenceId="o1" title="Upper body" onClose={() => {}} />);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('StartSheet — when the detail does not come', () => {
  it('a 404 still says the session moved with the new plan, with no retry', async () => {
    getOccurrenceDetail.mockRejectedValue(Object.assign(new Error('nope'), { status: 404 }));
    mount();
    await waitFor(() => expect(screen.getByText(/moved with your new plan/)).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('a 503 coach_unreachable reads as one honest sentence with a Try again', async () => {
    getOccurrenceDetail.mockRejectedValue(unreachable());
    const { container } = mount();
    await waitFor(() => expect(screen.getByText(/couldn't reach the coach/i)).toBeTruthy());
    expect(screen.getByText(/your plan is safe/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
    // Not the old line, and not the typing dots.
    expect(screen.queryByText(/close and tap it again/)).toBeNull();
    expect(container.querySelector('.typing')).toBeNull();
  });

  it('Try again re-fetches in place and opens the session when the coach is back', async () => {
    getOccurrenceDetail.mockRejectedValueOnce(unreachable()).mockResolvedValue(detail());
    const { container } = mount();
    const btn = await screen.findByRole('button', { name: 'Try again' });
    fireEvent.click(btn);
    // Back through loading — the dots, not the sentence — then the session.
    await waitFor(() => expect(container.querySelector('.typing')).toBeTruthy());
    await waitFor(() => expect(container.querySelector('.ss-start')?.textContent).toMatch(/I've got time/));
    expect(getOccurrenceDetail).toHaveBeenCalledTimes(2);
    expect(getOccurrenceDetail).toHaveBeenNthCalledWith(2, 'o1');
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('Try again that fails again keeps offering it — never a dead end', async () => {
    getOccurrenceDetail.mockRejectedValue(unreachable());
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(getOccurrenceDetail).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy());
  });

  it('any other failure keeps the plain error line, without a retry', async () => {
    getOccurrenceDetail.mockRejectedValue(Object.assign(new Error('detail failed: 500'), { status: 500 }));
    mount();
    await waitFor(() => expect(screen.getByText(/Couldn't open this just now/)).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });
});
