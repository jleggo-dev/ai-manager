/**
 * PERF-06 on the Progress tab: card shapes rather than the coach's typing dots, the journal row
 * real from the first frame (it reads nothing from the server, so it should never look like it is
 * waiting), and a failed load that says so instead of spinning.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

const useProgress = vi.fn();
vi.mock('../../lib/query/index.ts', () => ({ useProgress: () => useProgress() }));
vi.mock('../journal/JournalStore.tsx', () => ({ JournalStore: () => <div>journal-store</div> }));
vi.mock('../today/useGoalEventAdd.ts', () => ({ useGoalEventAdd: () => ({}) }));

const { ProgressView } = await import('./ProgressView.tsx');

function mount(state: Record<string, unknown>) {
  useProgress.mockReturnValue({ refetch: vi.fn(), ...state });
  return render(<ProgressView />);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ProgressView', () => {
  it('shows the dashboard’s shapes, never the coach’s typing dots', () => {
    const { container } = mount({ data: undefined, error: null });
    expect(container.querySelector('.typing')).toBeNull();
    expect(container.querySelector('.chat-loading')).toBeNull();
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
  });

  it('keeps the journal row real while the numbers are still coming', () => {
    mount({ data: undefined, error: null });
    // Not a placeholder bar: this button never waited on anything.
    expect(screen.getByText('Your journal')).toBeTruthy();
  });

  it('puts no numbers in the placeholder', () => {
    const { container } = mount({ data: undefined, error: null });
    expect(container.querySelector('[aria-busy="true"]')!.textContent).not.toMatch(/\d/);
  });

  it('says so when it has nothing and the load failed — it does not wait forever', () => {
    const { container } = mount({ data: undefined, error: new Error('offline') });
    expect(screen.getByText(/Couldn't load your progress just now/)).toBeTruthy();
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('drops the placeholder the moment real cards arrive', () => {
    const { container } = mount({
      data: { cards: [], trends: [], history: [] },
      error: null,
    });
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(screen.getByText('Progress')).toBeTruthy();
  });
});
