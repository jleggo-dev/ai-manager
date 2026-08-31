/**
 * PERF-06 on the Progress tab, carried across the W1-6 layout rebuild: card shapes rather than
 * the coach's typing dots, the journal row real from the first frame (it reads nothing from the
 * server, so it should never look like it is waiting), and a failed load that says so instead of
 * spinning. The page now renders from the layout (useProgressLayout), so that is the hook these
 * states key off; sections bind their own data behind it (BoundWidget, mocked here — section
 * data states are its concern, not the page's).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

const useProgressLayout = vi.fn();
// usePlan feeds only the header subline + streak line — undefined here keeps both absent, which
// is exactly the page's no-plan-cache state (a missing datum renders as absent, never zero).
vi.mock('../../lib/query/index.ts', () => ({
  useProgressLayout: () => useProgressLayout(),
  usePlan: () => ({ data: undefined }),
}));
vi.mock('../journal/JournalStore.tsx', () => ({ JournalStore: () => <div>journal-store</div> }));
vi.mock('./BoundWidget.tsx', () => ({
  BoundWidget: ({ spec }: { spec: { id: string } }) => <div data-testid={`bound-${spec.id}`} />,
}));
vi.mock('./SessionListScreen.tsx', () => ({ SessionListScreen: () => <div>session-list</div> }));
vi.mock('./WindowSeg.tsx', () => ({ WindowSeg: () => <div>window-seg</div> }));

const { ProgressView } = await import('./ProgressView.tsx');

function mount(state: Record<string, unknown>) {
  useProgressLayout.mockReturnValue({ refetch: vi.fn(), ...state });
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

  it('keeps the journal row real while the layout is still coming', () => {
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

  it('drops the placeholder the moment the layout arrives, and renders its sections in order', () => {
    const { container } = mount({
      data: {
        version: 1,
        status: 'default',
        sections: [
          { id: 'w-rhythm', kind: 'rhythm' },
          { id: 'w-history', kind: 'history' },
        ],
      },
      error: null,
    });
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(screen.getByText('Progress')).toBeTruthy();
    const bounds = [...container.querySelectorAll('[data-testid^="bound-"]')].map((n) => n.getAttribute('data-testid'));
    expect(bounds).toEqual(['bound-w-rhythm', 'bound-w-history']);
  });

  it('offers the empty page plainly when the layout has no sections', () => {
    mount({ data: { version: 1, status: 'default', sections: [] }, error: null });
    expect(screen.getByText(/whatever we count together gathers here/)).toBeTruthy();
  });
});
