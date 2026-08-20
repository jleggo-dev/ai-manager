/**
 * The ＋ sheet: a cached list, a skeleton instead of the dots, and — the one that matters — a
 * failed read that is never dressed as an empty plan.
 *
 * This sheet used to call `getPlan()` on every open (a second full `/plan` round trip for a list
 * the app was already holding) and `.catch(() => setActivities([]))`. That catch drew *"Nothing in
 * your plan yet — jot it below."* over a network failure: a person with a full committed rhythm
 * told they had none. It is the same failure-dressed-as-data shape that put a signed-in owner back
 * into onboarding on 2026-08-19, in a quieter place. `usePlan` throws, so the two are now
 * distinguishable and say different things.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

const usePlan = vi.fn();
vi.mock('../../lib/query/index.ts', () => ({ usePlan: () => usePlan() }));
vi.mock('../../lib/api.ts', () => ({ logDid: vi.fn(), logAdhoc: vi.fn() }));
vi.mock('./DoNowSection.tsx', () => ({ DoNowSection: () => null }));

const { LogDidSheet } = await import('./LogDidSheet.tsx');

const activity = (over: Record<string, unknown> = {}) => ({
  activity_id: 'a1',
  title: 'Easy run',
  kind: 'user',
  cadence: 'weekly',
  recurrence: '',
  time_of_day: '06:30',
  ...over,
});

function mount(state: Record<string, unknown>) {
  usePlan.mockReturnValue(state);
  return render(<LogDidSheet onClose={() => {}} onLogged={() => {}} />);
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('LogDidSheet', () => {
  it('paints the plan’s rows straight from the cache, with no loader at all', () => {
    const { container } = mount({ data: { activities: [activity()] }, error: null });
    expect(screen.getByText('Easy run')).toBeTruthy();
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(container.querySelector('.typing')).toBeNull();
  });

  it('shows row shapes, not typing dots, on the true first load', () => {
    const { container } = mount({ data: undefined, error: null });
    expect(container.querySelector('.typing')).toBeNull();
    expect(container.querySelector('[aria-busy="true"]')).toBeTruthy();
  });

  it('never reports a failed read as an empty plan', () => {
    mount({ data: undefined, error: new Error('offline') });
    expect(screen.queryByText(/Nothing in your plan yet/)).toBeNull();
    expect(screen.getByText(/Couldn't reach your plan just now/)).toBeTruthy();
  });

  it('keeps the off-plan line usable in every state — it reads nothing from the server', () => {
    for (const state of [
      { data: undefined, error: null },
      { data: undefined, error: new Error('offline') },
      { data: { activities: [] }, error: null },
    ]) {
      const { container } = mount(state);
      expect(container.querySelector('.ld-free')).toBeTruthy();
      cleanup();
    }
  });

  it('still says "nothing yet" when the plan really is empty', () => {
    mount({ data: { activities: [] }, error: null });
    expect(screen.getByText(/Nothing in your plan yet/)).toBeTruthy();
  });
});
