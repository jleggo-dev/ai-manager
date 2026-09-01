/**
 * "Schedule it…" (Settings › Your activities). Direct coverage of the sheet itself: day-chip
 * composition into `{days, time_of_day}`, the already-scheduled state offering "Take it off the
 * plan", and the one documented failure mode (409 → "no active plan") reading as its own honest
 * line rather than a generic retry.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { UserRoutine } from '../../lib/api.ts';

const api = vi.hoisted(() => ({
  scheduleUserRoutine: vi.fn(),
  unscheduleUserRoutine: vi.fn(),
}));
vi.mock('../../lib/api.ts', () => api);

const { ActivityScheduleSheet } = await import('./ActivityScheduleSheet.tsx');

function routine(over: Partial<UserRoutine> = {}): UserRoutine {
  return {
    routine_id: 'r1',
    name: 'Piano practice',
    session: { blocks: [], note: '', generated_at: '', version: 1 },
    provenance: { kind: 'blank' },
    created_at: '',
    updated_at: '',
    runs: 0,
    last_run: null,
    schedule: null,
    ...over,
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ActivityScheduleSheet — composing the schedule', () => {
  it('the primary action is disabled until at least one day is chosen', () => {
    render(<ActivityScheduleSheet routine={routine()} onClose={() => {}} onDone={() => {}} />);
    expect(screen.getByText('Put it on the plan')).toBeDisabled();
    fireEvent.click(screen.getByText('Tue'));
    expect(screen.getByText('Put it on the plan')).not.toBeDisabled();
  });

  it('composes multiple chosen days, in week order, with the chosen time of day', async () => {
    const onDone = vi.fn();
    api.scheduleUserRoutine.mockResolvedValueOnce({ ok: true });
    render(<ActivityScheduleSheet routine={routine()} onClose={() => {}} onDone={onDone} />);

    // Chosen out of order — the composed payload still comes out Monday-first.
    fireEvent.click(screen.getByText('Fri'));
    fireEvent.click(screen.getByText('Mon'));
    fireEvent.click(screen.getByText('Evening'));
    fireEvent.click(screen.getByText('Put it on the plan'));

    await waitFor(() =>
      expect(api.scheduleUserRoutine).toHaveBeenCalledWith('r1', { days: ['mon', 'fri'], time_of_day: 'evening' }),
    );
    expect(onDone).toHaveBeenCalledWith({ days: ['mon', 'fri'], time_of_day: 'evening' });
  });

  it('toggling a chosen day back off removes it from the composed payload', async () => {
    api.scheduleUserRoutine.mockResolvedValueOnce({ ok: true });
    render(<ActivityScheduleSheet routine={routine()} onClose={() => {}} onDone={() => {}} />);

    fireEvent.click(screen.getByText('Wed'));
    fireEvent.click(screen.getByText('Sat'));
    fireEvent.click(screen.getByText('Wed')); // off again
    fireEvent.click(screen.getByText('Put it on the plan'));

    await waitFor(() =>
      expect(api.scheduleUserRoutine).toHaveBeenCalledWith('r1', { days: ['sat'], time_of_day: 'anytime' }),
    );
  });

  it('defaults time of day to anytime when none is chosen', async () => {
    api.scheduleUserRoutine.mockResolvedValueOnce({ ok: true });
    render(<ActivityScheduleSheet routine={routine()} onClose={() => {}} onDone={() => {}} />);
    fireEvent.click(screen.getByText('Thu'));
    fireEvent.click(screen.getByText('Put it on the plan'));
    await waitFor(() =>
      expect(api.scheduleUserRoutine).toHaveBeenCalledWith('r1', { days: ['thu'], time_of_day: 'anytime' }),
    );
  });

  it('a 409 (ok:false) reads as the honest "no committed plan" line, not a generic retry', async () => {
    api.scheduleUserRoutine.mockResolvedValueOnce({ ok: false });
    const onDone = vi.fn();
    render(<ActivityScheduleSheet routine={routine()} onClose={() => {}} onDone={onDone} />);
    fireEvent.click(screen.getByText('Mon'));
    fireEvent.click(screen.getByText('Put it on the plan'));

    expect(await screen.findByText("There's no committed plan to put it on yet.")).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe('ActivityScheduleSheet — already on the plan', () => {
  const SCHEDULED = routine({ schedule: { days: ['tue', 'fri'], time_of_day: 'morning' } });

  it('shows the current days pre-selected and offers "Take it off the plan"', () => {
    render(<ActivityScheduleSheet routine={SCHEDULED} onClose={() => {}} onDone={() => {}} />);
    expect(screen.getByText(/Currently on the plan Tue & Fri/)).toBeInTheDocument();
    expect(screen.getByText('Tue')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Fri')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Morning')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Take it off the plan')).toBeInTheDocument();
  });

  it('"Take it off the plan" calls unscheduleUserRoutine and hands onDone null', async () => {
    api.unscheduleUserRoutine.mockResolvedValueOnce({ ok: true });
    const onDone = vi.fn();
    render(<ActivityScheduleSheet routine={SCHEDULED} onClose={() => {}} onDone={onDone} />);
    fireEvent.click(screen.getByText('Take it off the plan'));

    await waitFor(() => expect(api.unscheduleUserRoutine).toHaveBeenCalledWith('r1'));
    expect(onDone).toHaveBeenCalledWith(null);
  });

  it('a failed unschedule keeps the sheet open with a generic retry line', async () => {
    api.unscheduleUserRoutine.mockResolvedValueOnce({ ok: false });
    const onDone = vi.fn();
    render(<ActivityScheduleSheet routine={SCHEDULED} onClose={() => {}} onDone={onDone} />);
    fireEvent.click(screen.getByText('Take it off the plan'));

    expect(await screen.findByText("That didn't go through — try again in a moment.")).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe('ActivityScheduleSheet — cancel', () => {
  it('Cancel calls onClose and neither api function', () => {
    const onClose = vi.fn();
    render(<ActivityScheduleSheet routine={routine()} onClose={onClose} onDone={() => {}} />);
    fireEvent.click(screen.getByText('Cancel'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(api.scheduleUserRoutine).not.toHaveBeenCalled();
    expect(api.unscheduleUserRoutine).not.toHaveBeenCalled();
  });
});
