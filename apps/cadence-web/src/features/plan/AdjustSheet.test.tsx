import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AdjustSheet } from './AdjustSheet.tsx';

const previewReplan = vi.fn();
const getPendingReplan = vi.fn();
const confirmGoals = vi.fn();
const replan = vi.fn();
const dismissReplanPreview = vi.fn();

vi.mock('../../lib/api.ts', () => ({
  previewReplan: (...a: unknown[]) => previewReplan(...a),
  getPendingReplan: (...a: unknown[]) => getPendingReplan(...a),
  confirmGoals: (...a: unknown[]) => confirmGoals(...a),
  replan: (...a: unknown[]) => replan(...a),
  dismissReplanPreview: (...a: unknown[]) => dismissReplanPreview(...a),
}));
vi.mock('../../lib/applied-week-note.ts', () => ({ markWeekApplied: vi.fn() }));
/** The committed week the diff compares against — empty means a first plan (whole week opens). */
const committed = vi.hoisted(() => ({ activities: [] as unknown[] }));
vi.mock('../../lib/query/index.ts', () => ({
  usePlan: () => ({ data: { activities: committed.activities } }),
  useClockUnit: () => '24h',
}));

const NONE = { ok: true, proposal: null };
const PROPOSAL = { activities: [{ title: 'Dead hangs', cadence: '3x/week' }], note: 'Loosened the elbow guard.' };

beforeEach(() => {
  vi.clearAllMocks();
  getPendingReplan.mockResolvedValue(NONE);
  previewReplan.mockResolvedValue({ ok: true, running: true });
  confirmGoals.mockResolvedValue(undefined);
});

/**
 * Phase 2 routing (PLAN-CHANGES.md): a TYPED steer goes to the coach, who triages the size of
 * the ask — the compose branch must never start the whole-week synthesis pipeline. The one-tap
 * explicit rebuild (`mode='rebalance'`) is the only road that still does.
 */
describe('AdjustSheet — the typed steer goes to the coach', () => {
  it('hands the steer over verbatim and never fires the synthesis pipeline', async () => {
    const onSteerToCoach = vi.fn();
    render(<AdjustSheet onClose={vi.fn()} onCommitted={vi.fn()} onSteerToCoach={onSteerToCoach} />);

    // The hand-off is announced next to the box — landing in the chat must not be a surprise.
    expect(screen.getByText(/Tell me what should change/)).toBeTruthy();
    await waitFor(() => expect(getPendingReplan).toHaveBeenCalled());

    const box = screen.getByPlaceholderText(/one run day/);
    fireEvent.change(box, { target: { value: "add chest and abs to today's workout" } });
    fireEvent.click(screen.getByText('Send it over →'));

    expect(onSteerToCoach).toHaveBeenCalledWith("add chest and abs to today's workout");
    expect(previewReplan).not.toHaveBeenCalled();
    expect(replan).not.toHaveBeenCalled();
  });

  it('does not send a blank ask — the button waits for words', async () => {
    const onSteerToCoach = vi.fn();
    render(<AdjustSheet onClose={vi.fn()} onCommitted={vi.fn()} onSteerToCoach={onSteerToCoach} />);
    await waitFor(() => expect(getPendingReplan).toHaveBeenCalled());

    const send = screen.getByText('Send it over →') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.click(send);
    expect(onSteerToCoach).not.toHaveBeenCalled();
  });

  it('a prefilled bridge steer (baseline / "About today\'s…") rides the same door', async () => {
    const onSteerToCoach = vi.fn();
    render(
      <AdjustSheet
        onClose={vi.fn()}
        onCommitted={vi.fn()}
        onSteerToCoach={onSteerToCoach}
        initialSteer="About today's hill intervals: "
      />,
    );
    await waitFor(() => expect(getPendingReplan).toHaveBeenCalled());

    const box = screen.getByPlaceholderText(/one run day/);
    fireEvent.change(box, { target: { value: "About today's hill intervals: keep it to 20 minutes" } });
    fireEvent.click(screen.getByText('Send it over →'));

    expect(onSteerToCoach).toHaveBeenCalledWith("About today's hill intervals: keep it to 20 minutes");
    expect(previewReplan).not.toHaveBeenCalled();
  });

  it('a proposal the coach already drew is shown for confirm, never re-asked-for', async () => {
    getPendingReplan.mockResolvedValue({ ok: true, proposal: PROPOSAL });
    render(<AdjustSheet onClose={vi.fn()} onCommitted={vi.fn()} onSteerToCoach={vi.fn()} />);

    await screen.findByText('Make this my week');
    expect(screen.queryByText(/Tell me what should change/)).toBeNull();
    expect(previewReplan).not.toHaveBeenCalled();
  });
});

describe('AdjustSheet — mode="rebalance" stays on the direct pipeline', () => {
  it('auto-starts the whole-week synthesis with no steer box and no coach hand-off', async () => {
    getPendingReplan.mockResolvedValue(NONE);
    const onSteerToCoach = vi.fn();
    render(<AdjustSheet mode="rebalance" onClose={vi.fn()} onCommitted={vi.fn()} onSteerToCoach={onSteerToCoach} />);

    await waitFor(() => expect(previewReplan).toHaveBeenCalledTimes(1));
    expect(previewReplan).toHaveBeenCalledWith('');
    // The explicit rebuild needs no triage: nothing composes, nothing goes to the chat.
    expect(screen.queryByText(/Tell me what should change/)).toBeNull();
    expect(screen.queryByText('Send it over →')).toBeNull();
    expect(onSteerToCoach).not.toHaveBeenCalled();
    // The honest waiting copy takes the sheet over while the durable run works.
    await screen.findByText(/Reading back through your goals/);
  });
});

/**
 * "Show me the diff, and let me click to see the whole plan" (owner, 2026-09-01). With a
 * committed week to compare against, the sheet opens on what CHANGES; the whole week is one tap
 * away and one tap back. A first plan has nothing to compare against and opens on the week.
 */
describe('AdjustSheet — changes first', () => {
  const COMMITTED = [
    {
      activity_id: 'a1',
      commitment_id: 'c1',
      title: 'Weighted hill intervals',
      kind: 'user',
      cadence: 'Tuesdays',
      recurrence: 'FREQ=WEEKLY;BYDAY=TU',
      time_of_day: '06:00',
    },
    {
      activity_id: 'a2',
      commitment_id: 'c2',
      title: 'Easy run',
      kind: 'user',
      cadence: 'Thursdays',
      recurrence: 'FREQ=WEEKLY;BYDAY=TH',
      time_of_day: '06:00',
    },
  ];
  const RENAME = {
    activities: [
      {
        commitment_id: 'c1',
        title: 'Hill intervals',
        cadence: 'Tuesdays',
        recurrence: 'FREQ=WEEKLY;BYDAY=TU',
        time_of_day: '06:00',
      },
      {
        commitment_id: 'c2',
        title: 'Easy run',
        cadence: 'Thursdays',
        recurrence: 'FREQ=WEEKLY;BYDAY=TH',
        time_of_day: '06:00',
      },
    ],
    note: 'Just the name.',
  };

  beforeEach(() => {
    committed.activities = [];
  });

  it('opens on what changes, with the whole week one tap away', async () => {
    committed.activities = COMMITTED;
    getPendingReplan.mockResolvedValue({ ok: true, proposal: RENAME });
    render(<AdjustSheet onClose={vi.fn()} onCommitted={vi.fn()} onSteerToCoach={vi.fn()} />);

    await screen.findByText('Make this my week');
    // The changed row, and what it was — not the unchanged Thursday run.
    expect(screen.getByText('Hill intervals')).toBeTruthy();
    expect(screen.getByText('CHANGED')).toBeTruthy();
    expect(screen.getByText(/Was: “Weighted hill intervals”/)).toBeTruthy();
    expect(screen.queryByText('Easy run')).toBeNull();
    expect(screen.getByText(/1 row unchanged/)).toBeTruthy();

    fireEvent.click(screen.getByText('The whole week'));
    expect(screen.getByText('Easy run')).toBeTruthy();
    expect(screen.queryByText('CHANGED')).toBeNull();

    fireEvent.click(screen.getByText('What changes'));
    expect(screen.queryByText('Easy run')).toBeNull();
  });

  it('a first plan has nothing to diff against — the whole week opens, with no toggle', async () => {
    getPendingReplan.mockResolvedValue({ ok: true, proposal: RENAME });
    render(<AdjustSheet onClose={vi.fn()} onCommitted={vi.fn()} onSteerToCoach={vi.fn()} />);

    await screen.findByText('Make this my week');
    expect(screen.getByText('Easy run')).toBeTruthy();
    expect(screen.queryByText('What changes')).toBeNull();
  });
});
