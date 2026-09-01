import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MainTabs } from './MainTabs.tsx';

/**
 * The shell's hand-off wiring (Phase 2, PLAN-CHANGES.md): a steer from the plan surface must
 * arrive in the chat as a VISIBLE send — the same autoSend bridge "Start my check-in" uses —
 * with the user's words untouched, while the coach's explicit build card keeps the direct
 * rebalance sheet. The children are stubs; the wiring between them is what these tests pin.
 */
vi.mock('../plan/PlanView.tsx', () => ({
  PlanView: ({ onSteerCoach }: { onSteerCoach: (s: string) => void }) => (
    <button onClick={() => onSteerCoach("add chest and abs to today's workout")}>steer-to-coach</button>
  ),
}));
vi.mock('../onboarding/OnboardingChat.tsx', () => ({
  OnboardingChat: ({ autoSend, onBuild }: { autoSend?: { text: string; key: number } | null; onBuild: () => void }) => (
    <div>
      <div data-testid="auto-send">{autoSend?.text ?? ''}</div>
      <button onClick={onBuild}>coach-build-card</button>
    </div>
  ),
}));
vi.mock('../progress/ProgressView.tsx', () => ({ ProgressView: () => null }));
vi.mock('../settings/SettingsRoom.tsx', () => ({ SettingsRoom: () => null }));
vi.mock('../plan/AdjustSheet.tsx', () => ({
  AdjustSheet: ({ mode }: { mode?: string }) => <div data-testid="adjust-sheet">{mode}</div>,
}));
vi.mock('../plan/quick-add/QuickAddSheet.tsx', () => ({ QuickAddSheet: () => null }));
vi.mock('../gate/PlanCardSheet.tsx', () => ({ PlanCardSheet: () => null }));
vi.mock('../../components/CoachFace.tsx', () => ({ CoachFace: () => null }));
vi.mock('../nutrition/FoodHome.tsx', () => ({ FoodHome: () => null }));
vi.mock('../plan/week-review/WeekReviewSheet.tsx', () => ({ WeekReviewSheet: () => null }));
vi.mock('../plan/week-changes/WeekChangesSheet.tsx', () => ({ WeekChangesSheet: () => null }));

describe('MainTabs — the steer hand-off crosses to the chat', () => {
  it('a plan steer switches to the Coach tab and autoSends the exact words', () => {
    render(<MainTabs email={null} />);

    fireEvent.click(screen.getByText('steer-to-coach'));

    expect(screen.getByTestId('auto-send').textContent).toBe("add chest and abs to today's workout");
    const coachTab = screen.getByText('Coach').closest('button')!;
    expect(coachTab.className).toContain('tab-on');
    // No sheet opened anywhere along the way — the coach owns the ask from here.
    expect(screen.queryByTestId('adjust-sheet')).toBeNull();
  });

  it("the coach's build card still opens the direct-pipeline sheet, in rebalance mode", () => {
    render(<MainTabs email={null} />);

    fireEvent.click(screen.getByText('coach-build-card'));

    expect(screen.getByTestId('adjust-sheet').textContent).toBe('rebalance');
    // And nothing was auto-sent: an explicit rebuild is a tap, not a message.
    expect(screen.getByTestId('auto-send').textContent).toBe('');
  });
});
