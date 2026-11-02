import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { WeekChangesSheet } from './WeekChangesSheet.tsx';

const api = vi.hoisted(() => ({
  getPendingChangeDetail: vi.fn(),
  setPendingChangeToggles: vi.fn(async () => true),
  applyPendingChange: vi.fn(async (): Promise<{ ok: true } | { ok: false; message: string | null }> => ({ ok: true })),
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

/** Sunday 2026-11-01 onward: the run moves Thu → Fri (change 0), the optional add lands Saturday
 *  (change 1), piano stays put. */
const WEEK = [
  { date: '2026-11-01', entries: [] },
  { date: '2026-11-02', entries: [{ title: 'Piano practice', time: '8 pm', minutes: 30, kind: 'same' }] },
  { date: '2026-11-03', entries: [] },
  { date: '2026-11-04', entries: [] },
  { date: '2026-11-05', entries: [{ title: 'Easy run', time: '6:30 pm', kind: 'was', index: 0 }] },
  { date: '2026-11-06', entries: [{ title: 'Easy run', time: '6:15 am', kind: 'new', index: 0 }] },
  { date: '2026-11-07', entries: [{ title: 'Second strength day', time: '9 am', kind: 'new', index: 1 }] },
];

beforeEach(() => {
  vi.clearAllMocks();
  api.getPendingChangeDetail.mockResolvedValue({ plan_version: 4, items: ITEMS, removed: [], week: WEEK });
  api.setPendingChangeToggles.mockResolvedValue(true);
  api.applyPendingChange.mockResolvedValue({ ok: true });
});

afterEach(() => cleanup());

describe('WeekChangesSheet', () => {
  it('renders the change: header, eyebrow, NOW/AFTER columns, reason, OPTIONAL tag', async () => {
    render(<WeekChangesSheet onClose={vi.fn()} />);

    // "Changes for next week" / "WEEK 5" went 2026-11-01: a change applies from today, and the
    // number was the plan's version, not a week anyone counts.
    expect(await screen.findByText('What changes')).toBeInTheDocument();
    expect(screen.getByText('SUGGESTED BY YOUR COACH')).toBeInTheDocument();
    expect(screen.getAllByText('AFTER')).toHaveLength(2);
    expect(screen.getByText('Easy run')).toBeInTheDocument();
    expect(screen.getByText('Thu · 6:30 pm')).toBeInTheDocument();
    expect(screen.getByText('Fri · 6:15 am')).toBeInTheDocument();
    expect(screen.getByText(/made 4 of 4 morning sessions/)).toBeInTheDocument();
    expect(screen.getByText('NEW')).toBeInTheDocument(); // the pure add's NOW column
    expect(screen.getByText('OPTIONAL')).toBeInTheDocument();
    // The "Nothing changes until you tap this." helper was cut (owner, 2026-11-01: not useful).
    expect(screen.queryByText(/Nothing changes until/)).not.toBeInTheDocument();
  });

  it('defaults every toggle from the stored `enabled` — the optional add starts unchecked', async () => {
    render(<WeekChangesSheet onClose={vi.fn()} />);
    await screen.findByText('Easy run');

    const boxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes[0]!.checked).toBe(true);
    expect(boxes[1]!.checked).toBe(false);
    // One item defaults on — the button counts it.
    expect(screen.getByRole('button', { name: /Apply 1 change/ })).toBeInTheDocument();
  });

  it('a toggle flip updates the button label, both directions and pluralization', async () => {
    render(<WeekChangesSheet onClose={vi.fn()} />);
    await screen.findByText('Easy run');
    const boxes = screen.getAllByRole('checkbox');

    boxes[1]!.click(); // turn the optional add ON — now 2
    expect(await screen.findByRole('button', { name: /Apply 2 changes/ })).toBeInTheDocument();

    boxes[0]!.click(); // turn the run OFF — now 1 (the add)
    expect(await screen.findByRole('button', { name: /Apply 1 change/ })).toBeInTheDocument();

    boxes[1]!.click(); // turn the add back off too — now 0
    expect(await screen.findByRole('button', { name: 'Keep my plan as it is' })).toBeInTheDocument();
  });

  it('tapping Apply posts the toggles, then locks, in that order, then closes and reports applied', async () => {
    const onClose = vi.fn();
    const onApplied = vi.fn();
    render(<WeekChangesSheet onClose={onClose} onApplied={onApplied} />);
    await screen.findByText('Easy run');

    screen.getByRole('button', { name: /Apply 1 change/ }).click();

    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(api.setPendingChangeToggles).toHaveBeenCalledWith([
      { index: 0, enabled: true },
      { index: 1, enabled: false },
    ]);
    expect(api.applyPendingChange).toHaveBeenCalledTimes(1);
    const toggleOrder = api.setPendingChangeToggles.mock.invocationCallOrder[0]!;
    const lockOrder = api.applyPendingChange.mock.invocationCallOrder[0]!;
    expect(toggleOrder).toBeLessThan(lockOrder);
    expect(onApplied).toHaveBeenCalledTimes(1);
  });

  it('a failed apply shows a quiet inline error and leaves the sheet open with state intact', async () => {
    api.applyPendingChange.mockResolvedValue({ ok: false, message: null });
    const onClose = vi.fn();
    render(<WeekChangesSheet onClose={onClose} />);
    await screen.findByText('Easy run');

    screen.getByRole('button', { name: /Apply 1 change/ }).click();

    expect(await screen.findByText(/didn.t take/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    // The toggle state survives the failure — still showing the same button label.
    expect(screen.getByRole('button', { name: /Apply 1 change/ })).toBeInTheDocument();
  });

  it("a refused apply shows the server's own words, not the generic line", async () => {
    api.applyPendingChange.mockResolvedValue({
      ok: false,
      message: 'That change card expired — ask me again and I will put it back up.',
    });
    render(<WeekChangesSheet onClose={vi.fn()} />);
    await screen.findByText('Easy run');

    screen.getByRole('button', { name: /Apply 1 change/ }).click();

    expect(await screen.findByText(/change card expired/)).toBeInTheDocument();
    expect(screen.queryByText(/didn.t take/)).not.toBeInTheDocument();
  });

  it('falls back to one warm message when there is nothing to change', async () => {
    api.getPendingChangeDetail.mockResolvedValue({ plan_version: null, items: [] });
    render(<WeekChangesSheet onClose={vi.fn()} />);
    expect(await screen.findByText(/Nothing to change right now/)).toBeInTheDocument();
  });

  it('a swap inside a session shows its new contents — days and time alone read the same', async () => {
    api.getPendingChangeDetail.mockResolvedValue({
      plan_version: 30,
      items: [
        {
          index: 7,
          title: 'Obstacle strength',
          enabled: true,
          now: 'Sun · 4:30 pm · 45 min',
          next: 'Sun · 4:30 pm · 45 min',
          how_to: 'Replace the bike warm-up with 5 minutes of easy step-ups.',
        },
      ],
      removed: [],
    });
    render(<WeekChangesSheet onClose={vi.fn()} />);

    expect(await screen.findByText(/easy step-ups/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Apply 1 change/ })).toBeInTheDocument();
  });

  it('lists a dropped commitment without a toggle, and counts it in the button', async () => {
    api.getPendingChangeDetail.mockResolvedValue({ plan_version: 4, items: [ITEMS[0]], removed: ['Sauna'] });
    render(<WeekChangesSheet onClose={vi.fn()} />);

    expect(await screen.findByText('Sauna')).toBeInTheDocument();
    expect(screen.getByText('Comes off your plan.')).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(screen.getByRole('button', { name: /Apply 2 changes/ })).toBeInTheDocument();
  });

  it('a change that only drops something still opens, rather than saying there is nothing', async () => {
    api.getPendingChangeDetail.mockResolvedValue({ plan_version: 4, items: [], removed: ['Sauna'] });
    render(<WeekChangesSheet onClose={vi.fn()} />);

    expect(await screen.findByText('Sauna')).toBeInTheDocument();
    expect(screen.queryByText(/Nothing to change right now/)).not.toBeInTheDocument();
  });

  it('opens on the change alone; the week strip opens the week, grouped by day', async () => {
    render(<WeekChangesSheet onClose={vi.fn()} />);
    await screen.findByText('What changes');
    expect(screen.queryByText('Tomorrow')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Week view' }));

    expect(await screen.findByText('Your week')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Today' })).toHaveTextContent('Nothing planned');
    expect(screen.getByRole('region', { name: 'Thu · Nov 5' })).toHaveTextContent('Easy run');
    expect(screen.getByRole('region', { name: 'Fri · Nov 6' })).toHaveTextContent('New');
    // Apply stays in reach at full height.
    expect(screen.getByRole('button', { name: /Apply 1 change/ })).toBeInTheDocument();
  });

  it('the week follows the toggles — an add left off is not in it', async () => {
    render(<WeekChangesSheet onClose={vi.fn()} initial="full" />);
    expect(await screen.findByText('Your week')).toBeInTheDocument();
    expect(screen.queryByText('Second strength day')).not.toBeInTheDocument();
  });

  it('a tap on the handle moves between the change and the week', async () => {
    const { container } = render(<WeekChangesSheet onClose={vi.fn()} />);
    await screen.findByText('What changes');
    const handle = container.querySelector('.wkc-drag')!;

    fireEvent.pointerDown(handle, { clientY: 300 });
    fireEvent.pointerUp(handle, { clientY: 300 });
    expect(await screen.findByText('Your week')).toBeInTheDocument();

    fireEvent.pointerDown(handle, { clientY: 300 });
    fireEvent.pointerUp(handle, { clientY: 300 });
    expect(await screen.findByText('What changes')).toBeInTheDocument();
  });

  it('dragging the handle up opens the week; down from the change closes the sheet', async () => {
    const onClose = vi.fn();
    const { container } = render(<WeekChangesSheet onClose={onClose} />);
    await screen.findByText('What changes');
    const handle = container.querySelector('.wkc-drag')!;

    fireEvent.pointerDown(handle, { clientY: 400 });
    fireEvent.pointerMove(handle, { clientY: 320 });
    fireEvent.pointerUp(handle, { clientY: 320 });
    expect(await screen.findByText('Your week')).toBeInTheDocument();

    fireEvent.pointerDown(handle, { clientY: 200 });
    fireEvent.pointerMove(handle, { clientY: 300 });
    fireEvent.pointerUp(handle, { clientY: 300 });
    expect(await screen.findByText('What changes')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.pointerDown(handle, { clientY: 200 });
    fireEvent.pointerMove(handle, { clientY: 300 });
    fireEvent.pointerUp(handle, { clientY: 300 });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('the close control reports back to the caller', async () => {
    const onClose = vi.fn();
    render(<WeekChangesSheet onClose={onClose} />);
    await screen.findByText('What changes');
    screen.getByRole('button', { name: 'Close' }).click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
