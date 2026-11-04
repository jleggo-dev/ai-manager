/**
 * The running clock is never invisible (walkthrough v3 R6): on every screen that is not the
 * walkthrough — the Coach and Progress tabs, the Settings Room, Food — one pill shows the clock
 * and a tap lands back on Plan, where the remembered session reopens on its step. On the Plan
 * tab itself the walkthrough shows the clock, so there is no pill. Children are stubs; the
 * shell's own wiring is what this pins.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MainTabs } from './MainTabs.tsx';
import { registerClock, unregisterClock } from '../walkthrough/runningClock.ts';

vi.mock('../plan/PlanView.tsx', () => ({ PlanView: () => <div data-testid="plan-view" /> }));
vi.mock('../onboarding/OnboardingChat.tsx', () => ({ OnboardingChat: () => <div data-testid="coach-view" /> }));
vi.mock('../progress/ProgressView.tsx', () => ({ ProgressView: () => <div data-testid="progress-view" /> }));
vi.mock('../settings/SettingsRoom.tsx', () => ({ SettingsRoom: () => <div data-testid="settings-room" /> }));
vi.mock('../plan/AdjustSheet.tsx', () => ({ AdjustSheet: () => null }));
vi.mock('../plan/quick-add/QuickAddSheet.tsx', () => ({ QuickAddSheet: () => null }));
vi.mock('../gate/PlanCardSheet.tsx', () => ({ PlanCardSheet: () => null }));
vi.mock('../../components/CoachFace.tsx', () => ({ CoachFace: () => null }));
vi.mock('../nutrition/FoodHome.tsx', () => ({ FoodHome: () => null }));
vi.mock('../plan/week-review/WeekReviewSheet.tsx', () => ({ WeekReviewSheet: () => null }));
vi.mock('../plan/week-changes/WeekChangesSheet.tsx', () => ({ WeekChangesSheet: () => null }));
vi.mock('../builder/ActivityBuilder.tsx', () => ({ ActivityBuilder: () => null }));

const pill = () => screen.queryByRole('button', { name: 'Back to the clock' });
const tab = (name: string) => fireEvent.click(screen.getByText(name).closest('button')!);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-04T10:00:00Z'));
});
afterEach(() => {
  cleanup();
  unregisterClock();
  vi.useRealTimers();
  window.localStorage.clear();
});

describe('MainTabs — the running clock pill', () => {
  it('shows on the Coach tab while a clock runs, with the clock, and hides once it stops', () => {
    render(<MainTabs email={null} />);
    tab('Coach');
    expect(pill()).toBeNull();

    act(() =>
      registerClock({
        stepId: 's1',
        title: 'Farmer carry',
        kind: 'timer',
        startedAt: Date.now() - 28_000,
        base: 0,
        targetSec: 60,
        chime: true,
      }),
    );
    expect(pill()).toHaveTextContent('Farmer carry · 0:32');
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(pill()).toHaveTextContent('Farmer carry · 0:30');

    act(() => unregisterClock());
    expect(pill()).toBeNull();
  });

  it.each(['Progress', 'Settings'])('shows on %s too', (name) => {
    registerClock({
      stepId: 's1',
      title: 'Plank',
      kind: 'timer',
      startedAt: Date.now(),
      base: 0,
      targetSec: 30,
      chime: true,
    });
    render(<MainTabs email={null} />);
    tab(name);
    expect(pill()).toHaveTextContent('Plank · 0:30');
  });

  it('never shows on the Plan tab, where the walkthrough itself shows the clock', () => {
    registerClock({
      stepId: 's1',
      title: 'Plank',
      kind: 'timer',
      startedAt: Date.now(),
      base: 0,
      targetSec: 30,
      chime: true,
    });
    render(<MainTabs email={null} />);
    expect(screen.getByTestId('plan-view')).toBeInTheDocument();
    expect(pill()).toBeNull();
  });

  it('a tap lands back on Plan, and the pill goes', () => {
    registerClock({
      stepId: 's1',
      title: 'Plank',
      kind: 'timer',
      startedAt: Date.now(),
      base: 0,
      targetSec: 30,
      chime: true,
    });
    render(<MainTabs email={null} />);
    tab('Settings');
    expect(screen.getByTestId('settings-room')).toBeInTheDocument();
    fireEvent.click(pill()!);
    expect(screen.getByTestId('plan-view')).toBeInTheDocument();
    expect(screen.queryByTestId('settings-room')).toBeNull();
    expect(pill()).toBeNull();
  });
});
