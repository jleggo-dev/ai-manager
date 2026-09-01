/**
 * DoNowSection had no test file at all before this parcel — every row here is a tappable control
 * whose whole job is to play a walkthrough (or open the journal) and, on completion, call the two
 * callbacks the host sheet relies on to log and close. Presses only; the empty/loading/pinned
 * render-shape questions belong to whoever writes the mount-level suite.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react';

const getNowMenu = vi.fn(async (..._a: unknown[]) => [] as unknown[]);
vi.mock('../../lib/api.ts', () => ({ getNowMenu: (...a: unknown[]) => getNowMenu(...a) }));

vi.mock('../walkthrough/Walkthrough.tsx', () => ({
  Walkthrough: ({ title, onComplete }: { title: string; onComplete: () => void }) => (
    <div>
      <div>playing: {title}</div>
      <button onClick={onComplete}>Finish</button>
    </div>
  ),
}));

vi.mock('../journal/JournalWrite.tsx', () => ({
  JournalWrite: ({ onKept }: { onKept: () => void }) => (
    <div>
      <div>journal open</div>
      <button onClick={onKept}>Done writing</button>
    </div>
  ),
}));

const { DoNowSection } = await import('./DoNowSection.tsx');

const nowItem = (over: Record<string, unknown> = {}) => ({
  id: 'n1',
  label: 'Easy 5k',
  area: 'movement',
  action: { kind: 'tool', tool: 'timer', params: { duration_min: 20 } },
  ...over,
});

function mount(props: Partial<{ onClose: () => void; onLogged: () => void }> = {}) {
  return render(<DoNowSection onClose={props.onClose ?? (() => {})} onLogged={props.onLogged ?? (() => {})} />);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('DoNowSection — a pinned row plays through to the same two callbacks as a plain one', () => {
  it('the pinned row plays its walkthrough, and Finish calls onLogged then onClose', async () => {
    getNowMenu.mockResolvedValue([nowItem({ id: 'p1', label: 'Three long exhales', pinned: true })]);
    const onLogged = vi.fn();
    const onClose = vi.fn();
    mount({ onLogged, onClose });

    fireEvent.click(await screen.findByText('Three long exhales'));
    expect(screen.getByText('playing: Three long exhales')).toBeTruthy();
    fireEvent.click(screen.getByText('Finish'));

    expect(onLogged).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    expect(onLogged.mock.invocationCallOrder[0]!).toBeLessThan(onClose.mock.invocationCallOrder[0]!);
  });

  it('a plain (non-pinned) row plays and finishes the same way', async () => {
    getNowMenu.mockResolvedValue([nowItem({ id: 'r1', label: 'Easy 5k' })]);
    const onLogged = vi.fn();
    const onClose = vi.fn();
    mount({ onLogged, onClose });

    fireEvent.click(await screen.findByText('Easy 5k'));
    fireEvent.click(screen.getByText('Finish'));

    expect(onLogged).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('a pinned row sits alongside plain rows — tapping a plain row leaves the pinned tile alone', async () => {
    getNowMenu.mockResolvedValue([
      nowItem({ id: 'p1', label: 'Three long exhales', pinned: true }),
      nowItem({ id: 'r1', label: 'Easy 5k' }),
    ]);
    const onLogged = vi.fn();
    mount({ onLogged });

    fireEvent.click(await screen.findByText('Easy 5k'));
    expect(screen.getByText('playing: Easy 5k')).toBeTruthy();
    fireEvent.click(screen.getByText('Finish'));
    expect(onLogged).toHaveBeenCalledTimes(1);
  });
});

describe('DoNowSection — a journal row opens the writing page, not the walkthrough', () => {
  it('a journal-kind row opens JournalWrite, and finishing it calls onLogged then onClose', async () => {
    getNowMenu.mockResolvedValue([
      nowItem({ id: 'j1', label: 'Write it out', action: { kind: 'tool', tool: 'journal', params: {} } }),
    ]);
    const onLogged = vi.fn();
    const onClose = vi.fn();
    mount({ onLogged, onClose });

    fireEvent.click(await screen.findByText('Write it out'));
    expect(screen.getByText('journal open')).toBeTruthy();
    fireEvent.click(screen.getByText('Done writing'));

    expect(onLogged).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    expect(onLogged.mock.invocationCallOrder[0]!).toBeLessThan(onClose.mock.invocationCallOrder[0]!);
  });
});

describe('DoNowSection — activity-kind rows are dropped, never rendered as a dead tap', () => {
  it('an activity-action row from the menu never appears as a pressable control', async () => {
    getNowMenu.mockResolvedValue([
      nowItem({ id: 'a1', label: 'Deleted task', action: { kind: 'activity', activityId: 'x' } }),
    ]);
    mount();
    await waitFor(() => expect(getNowMenu).toHaveBeenCalled());
    expect(screen.queryByText('Deleted task')).toBeNull();
  });
});
