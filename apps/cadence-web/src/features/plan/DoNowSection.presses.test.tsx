/**
 * DoNowSection — every row here is a tappable control whose whole job is to play a walkthrough
 * (or open the journal) and, on completion, call the two callbacks the host sheet relies on to log
 * and close. Presses only; the empty/pinned render-shape questions belong to the mount-level suite.
 *
 * Purely presentational since the device-test fix (2026-09-01, "Calming techniques"): `items` is a
 * prop now, not a fetch DoNowSection makes itself. The now-menu fetch AND its tool-kind filter (the
 * thing that used to guard against an activity-kind row rendering as a dead tap) both moved up to
 * the ＋ sheet — QuickAddSheet.tsx, covered by QuickAddSheet.test.tsx — so every test here hands
 * `items` in directly, already the shape the sheet promises.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { NowMenuItem } from '@cadence/shared';

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

const nowItem = (over: Partial<NowMenuItem> = {}): NowMenuItem => ({
  id: 'n1',
  label: 'Easy 5k',
  area: 'movement',
  action: { kind: 'tool', tool: 'timer', params: { duration_min: 20 } },
  ...over,
});

function mount(items: NowMenuItem[], props: Partial<{ onClose: () => void; onLogged: () => void }> = {}) {
  return render(
    <DoNowSection items={items} onClose={props.onClose ?? (() => {})} onLogged={props.onLogged ?? (() => {})} />,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('DoNowSection — a pinned row plays through to the same two callbacks as a plain one', () => {
  it('the pinned row plays its walkthrough, and Finish calls onLogged then onClose', () => {
    const onLogged = vi.fn();
    const onClose = vi.fn();
    mount([nowItem({ id: 'p1', label: 'Three long exhales', pinned: true })], { onLogged, onClose });

    fireEvent.click(screen.getByText('Three long exhales'));
    expect(screen.getByText('playing: Three long exhales')).toBeTruthy();
    fireEvent.click(screen.getByText('Finish'));

    expect(onLogged).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    expect(onLogged.mock.invocationCallOrder[0]!).toBeLessThan(onClose.mock.invocationCallOrder[0]!);
  });

  it('a plain (non-pinned) row plays and finishes the same way', () => {
    const onLogged = vi.fn();
    const onClose = vi.fn();
    mount([nowItem({ id: 'r1', label: 'Easy 5k' })], { onLogged, onClose });

    fireEvent.click(screen.getByText('Easy 5k'));
    fireEvent.click(screen.getByText('Finish'));

    expect(onLogged).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
  });

  it('a pinned row sits alongside plain rows — tapping a plain row leaves the pinned tile alone', () => {
    const onLogged = vi.fn();
    mount([nowItem({ id: 'p1', label: 'Three long exhales', pinned: true }), nowItem({ id: 'r1', label: 'Easy 5k' })], {
      onLogged,
    });

    fireEvent.click(screen.getByText('Easy 5k'));
    expect(screen.getByText('playing: Easy 5k')).toBeTruthy();
    fireEvent.click(screen.getByText('Finish'));
    expect(onLogged).toHaveBeenCalledTimes(1);
  });
});

describe('DoNowSection — a journal row opens the writing page, not the walkthrough', () => {
  it('a journal-kind row opens JournalWrite, and finishing it calls onLogged then onClose', () => {
    const onLogged = vi.fn();
    const onClose = vi.fn();
    mount([nowItem({ id: 'j1', label: 'Write it out', action: { kind: 'tool', tool: 'journal', params: {} } })], {
      onLogged,
      onClose,
    });

    fireEvent.click(screen.getByText('Write it out'));
    expect(screen.getByText('journal open')).toBeTruthy();
    fireEvent.click(screen.getByText('Done writing'));

    expect(onLogged).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    expect(onLogged.mock.invocationCallOrder[0]!).toBeLessThan(onClose.mock.invocationCallOrder[0]!);
  });
});

describe('DoNowSection — an empty items list', () => {
  it('renders nothing at all — a real state, not a failure', () => {
    const { container } = mount([]);
    expect(container).toBeEmptyDOMElement();
  });
});
