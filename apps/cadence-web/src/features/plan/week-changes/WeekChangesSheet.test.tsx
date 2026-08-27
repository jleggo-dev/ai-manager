import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { WeekChangesSheet } from './WeekChangesSheet.tsx';

const api = vi.hoisted(() => ({
  getPendingChangeDetail: vi.fn(),
  setPendingChangeToggles: vi.fn(async () => true),
  lockPlan: vi.fn(async () => ({ status: 200, body: {} })),
}));
vi.mock('../../../lib/api.ts', () => api);

const ITEMS = [
  {
    index: 0,
    title: 'Easy run',
    change_reason: "You've made 4 of 4 morning sessions this month and 1 of 4 evening ones.",
    enabled: true,
    now: 'Thu · 6:30 pm',
    next: 'Fri · 6:15 am',
  },
  {
    index: 1,
    title: 'Second strength day',
    enabled: false,
    now: null,
    next: 'Sat · 9 am',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  api.getPendingChangeDetail.mockResolvedValue({ plan_version: 4, items: ITEMS });
  api.setPendingChangeToggles.mockResolvedValue(true);
  api.lockPlan.mockResolvedValue({ status: 200, body: {} });
});

afterEach(() => cleanup());

describe('WeekChangesSheet', () => {
  it('renders the mockup copy verbatim: header, eyebrow, NOW/NEXT columns, reason, OPTIONAL tag', async () => {
    render(<WeekChangesSheet onClose={vi.fn()} />);

    expect(await screen.findByText('Changes for next week')).toBeInTheDocument();
    expect(screen.getByText('WEEK 5 · SUGGESTED BY YOUR COACH')).toBeInTheDocument();
    expect(screen.getByText('Easy run')).toBeInTheDocument();
    expect(screen.getByText('Thu · 6:30 pm')).toBeInTheDocument();
    expect(screen.getByText('Fri · 6:15 am')).toBeInTheDocument();
    expect(screen.getByText(/made 4 of 4 morning sessions/)).toBeInTheDocument();
    expect(screen.getByText('NEW')).toBeInTheDocument(); // the pure add's NOW column
    expect(screen.getByText('OPTIONAL')).toBeInTheDocument();
    expect(screen.getByText('Nothing changes until you tap this.')).toBeInTheDocument();
  });

  it('defaults every toggle from the stored `enabled` — the optional add starts unchecked', async () => {
    render(<WeekChangesSheet onClose={vi.fn()} />);
    await screen.findByText('Easy run');

    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes[0]!.checked).toBe(true);
    expect(boxes[1]!.checked).toBe(false);
    // One item defaults on — the button counts it.
    expect(screen.getByRole('button', { name: /Apply 1 change and build next week/ })).toBeInTheDocument();
  });

  it('a toggle flip updates the button label, both directions and pluralization', async () => {
    render(<WeekChangesSheet onClose={vi.fn()} />);
    await screen.findByText('Easy run');
    const boxes = screen.getAllByRole('checkbox');

    boxes[1]!.click(); // turn the optional add ON — now 2
    expect(await screen.findByRole('button', { name: /Apply 2 changes and build next week/ })).toBeInTheDocument();

    boxes[0]!.click(); // turn the run OFF — now 1 (the add)
    expect(await screen.findByRole('button', { name: /Apply 1 change and build next week/ })).toBeInTheDocument();

    boxes[1]!.click(); // turn the add back off too — now 0
    expect(await screen.findByRole('button', { name: 'Build next week with no changes' })).toBeInTheDocument();
  });

  it('tapping Apply posts the toggles, then locks, in that order, then closes and reports applied', async () => {
    const onClose = vi.fn();
    const onApplied = vi.fn();
    render(<WeekChangesSheet onClose={onClose} onApplied={onApplied} />);
    await screen.findByText('Easy run');

    screen.getByRole('button', { name: /Apply 1 change and build next week/ }).click();

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(api.setPendingChangeToggles).toHaveBeenCalledWith([
      { index: 0, enabled: true },
      { index: 1, enabled: false },
    ]);
    expect(api.lockPlan).toHaveBeenCalledTimes(1);
    const toggleOrder = api.setPendingChangeToggles.mock.invocationCallOrder[0]!;
    const lockOrder = api.lockPlan.mock.invocationCallOrder[0]!;
    expect(toggleOrder).toBeLessThan(lockOrder);
    expect(onApplied).toHaveBeenCalledTimes(1);
  });

  it('a failed apply shows a quiet inline error and leaves the sheet open with state intact', async () => {
    api.lockPlan.mockResolvedValue({ status: 422, body: {} });
    const onClose = vi.fn();
    render(<WeekChangesSheet onClose={onClose} />);
    await screen.findByText('Easy run');

    screen.getByRole('button', { name: /Apply 1 change and build next week/ }).click();

    expect(await screen.findByText(/didn.t take/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    // The toggle state survives the failure — still showing the same button label.
    expect(screen.getByRole('button', { name: /Apply 1 change and build next week/ })).toBeInTheDocument();
  });

  it('falls back to one warm message when there is nothing to change', async () => {
    api.getPendingChangeDetail.mockResolvedValue({ plan_version: null, items: [] });
    render(<WeekChangesSheet onClose={vi.fn()} />);
    expect(await screen.findByText(/Nothing to change right now/)).toBeInTheDocument();
  });

  it('the close control reports back to the caller', async () => {
    const onClose = vi.fn();
    render(<WeekChangesSheet onClose={onClose} />);
    await screen.findByText('Changes for next week');
    screen.getByRole('button', { name: 'Close' }).click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
