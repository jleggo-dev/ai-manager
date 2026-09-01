/**
 * The express lane (Activity Builder W2-B): a labelled shortcut row for the user's most-used
 * routine, above the ＋ sheet's derived quick-add rows. Test bar is the owner mandate — every
 * tappable gets a test that presses it and asserts the call, plus every "never renders" case:
 * below the finishes floor, empty steps, a failed read, and the coach's own pinned item.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const getRoutines = vi.fn(async (..._a: unknown[]) => [] as unknown[] | null);
vi.mock('../../../lib/api.ts', () => ({
  getRoutines: (...a: unknown[]) => getRoutines(...a),
}));

const { QuickAddPill } = await import('./QuickAddPill.tsx');

const routine = (over: Record<string, unknown> = {}) => ({
  commitment_id: 'c1',
  activity_id: 'a1',
  title: 'Easy 5k',
  area: 'movement',
  cadence: 'weekly',
  duration_min: 32,
  steps: ['warm-up', 'zone 2', 'stretch'],
  finishes: 11,
  last_done: '2026-08-30',
  on_plan: true,
  ...over,
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('QuickAddPill', () => {
  it('renders the most-used routine as a labelled row with the real finish count', async () => {
    getRoutines.mockResolvedValue([routine()]);
    render(<QuickAddPill suppressed={false} onPlay={() => {}} />);
    expect(await screen.findByText('Easy 5k')).toBeTruthy();
    expect(screen.getByText('finished 11 times')).toBeTruthy();
  });

  it('pressing the pill calls onPlay with the exact routine', async () => {
    const r = routine();
    getRoutines.mockResolvedValue([r]);
    const onPlay = vi.fn();
    render(<QuickAddPill suppressed={false} onPlay={onPlay} />);
    fireEvent.click(await screen.findByLabelText('Easy 5k'));
    expect(onPlay).toHaveBeenCalledWith(r);
  });

  it('never renders a routine finished fewer than 3 times — a shortcut to something unused is not one', async () => {
    getRoutines.mockResolvedValue([routine({ finishes: 2 })]);
    render(<QuickAddPill suppressed={false} onPlay={() => {}} />);
    await waitFor(() => expect(getRoutines).toHaveBeenCalled());
    expect(screen.queryByText('Easy 5k')).toBeNull();
  });

  it('picks the first eligible routine — the list is already finishes-ranked, never re-sorted', async () => {
    getRoutines.mockResolvedValue([
      routine({ activity_id: 'a1', title: 'Easy 5k', finishes: 11 }),
      routine({ activity_id: 'a2', title: 'Hill repeats', finishes: 40 }),
    ]);
    render(<QuickAddPill suppressed={false} onPlay={() => {}} />);
    expect(await screen.findByText('Easy 5k')).toBeTruthy();
    expect(screen.queryByText('Hill repeats')).toBeNull();
  });

  it('skips a routine below the finishes floor for the next eligible one, still in list order', async () => {
    getRoutines.mockResolvedValue([
      routine({ activity_id: 'a1', title: 'New thing', finishes: 1 }),
      routine({ activity_id: 'a2', title: 'Easy 5k', finishes: 11 }),
    ]);
    render(<QuickAddPill suppressed={false} onPlay={() => {}} />);
    expect(await screen.findByText('Easy 5k')).toBeTruthy();
    expect(screen.queryByText('New thing')).toBeNull();
  });

  it('never renders a routine with no cached steps — nothing there to actually play', async () => {
    getRoutines.mockResolvedValue([routine({ steps: [] })]);
    render(<QuickAddPill suppressed={false} onPlay={() => {}} />);
    await waitFor(() => expect(getRoutines).toHaveBeenCalled());
    expect(screen.queryByText('Easy 5k')).toBeNull();
  });

  it('renders nothing on a null (failed) read — a blip never invents a shortcut', async () => {
    getRoutines.mockResolvedValue(null);
    render(<QuickAddPill suppressed={false} onPlay={() => {}} />);
    await waitFor(() => expect(getRoutines).toHaveBeenCalled());
    expect(screen.queryByText('Easy 5k')).toBeNull();
  });

  it('renders nothing when the coach has her own pinned item (suppressed)', async () => {
    getRoutines.mockResolvedValue([routine()]);
    render(<QuickAddPill suppressed={true} onPlay={() => {}} />);
    await waitFor(() => expect(getRoutines).toHaveBeenCalled());
    expect(screen.queryByText('Easy 5k')).toBeNull();
  });
});
