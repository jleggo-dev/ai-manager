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
  PlanView: ({ onSteerCoach, reloadSignal }: { onSteerCoach: (s: string) => void; reloadSignal?: number }) => (
    <>
      <button onClick={() => onSteerCoach("add chest and abs to today's workout")}>steer-to-coach</button>
      <div data-testid="plan-reload">{reloadSignal ?? 0}</div>
    </>
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
// The ＋ sheet is a stub with the one control this suite cares about: "Build my own"'s hand-off.
// Everything else about the sheet (rows, screen 2, the routines shelf) is QuickAddSheet.test.tsx's
// and QuickAddTense.test.tsx's job.
vi.mock('../plan/quick-add/QuickAddSheet.tsx', () => ({
  QuickAddSheet: ({ onBuild }: { onBuild?: (seed?: unknown) => void }) => (
    <button onClick={() => onBuild?.({ name: 'Piano — mine' })}>quick-add-build</button>
  ),
}));
vi.mock('../gate/PlanCardSheet.tsx', () => ({ PlanCardSheet: () => null }));
vi.mock('../../components/CoachFace.tsx', () => ({ CoachFace: () => null }));
vi.mock('../nutrition/FoodHome.tsx', () => ({ FoodHome: () => null }));
vi.mock('../plan/week-review/WeekReviewSheet.tsx', () => ({ WeekReviewSheet: () => null }));
vi.mock('../plan/week-changes/WeekChangesSheet.tsx', () => ({ WeekChangesSheet: () => null }));
// The Activity Builder (Activity Builder wave 3) — a stub exposing the seed it was given plus its
// two exits, so this suite can pin the shell's own hosting wiring without depending on the real
// builder's internals (features/builder/**, a parallel parcel).
vi.mock('../builder/ActivityBuilder.tsx', () => ({
  ActivityBuilder: ({
    initial,
    onSaved,
    onClose,
    onAskReview,
  }: {
    initial?: unknown;
    onSaved: (routine: unknown) => void;
    onClose: () => void;
    onAskReview?: (text: string) => void;
  }) => (
    <div>
      <div data-testid="builder-seed">{JSON.stringify(initial ?? null)}</div>
      {onAskReview && (
        <button onClick={() => onAskReview('Can you look over my activity "Hotel HIIT"?')}>builder-ask-review</button>
      )}
      <button onClick={() => onSaved({ routine_id: 'r1' })}>builder-save</button>
      <button onClick={onClose}>builder-close</button>
    </div>
  ),
}));

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

/**
 * Hosting the Activity Builder (Activity Builder wave 3) — the FoodHome idiom, reused verbatim:
 * the ＋ sheet's "Build my own" replaces the tab content with the builder while the tab bar stays,
 * and both of the builder's own exits (Save, Cancel) land back on the plan tab — only Save also
 * counts as "something happened" and bumps the reload PlanView reads.
 */
describe('MainTabs — hosting the Activity Builder', () => {
  it('the ＋ sheet\'s "Build my own" opens the builder, full-screen, seeded from the sheet', () => {
    render(<MainTabs email={null} />);

    fireEvent.click(screen.getByLabelText('Quick add'));
    fireEvent.click(screen.getByText('quick-add-build'));

    expect(screen.getByTestId('builder-seed').textContent).toBe(JSON.stringify({ name: 'Piano — mine' }));
    // The tab content it replaced is gone — same escape FoodHome uses.
    expect(screen.queryByText('steer-to-coach')).toBeNull();
    // The tab bar itself survives underneath.
    expect(screen.getByText('Plan').closest('button')).toBeTruthy();
  });

  it('Save lands back on the plan tab and bumps the reload signal PlanView reads', () => {
    render(<MainTabs email={null} />);
    fireEvent.click(screen.getByLabelText('Quick add'));
    fireEvent.click(screen.getByText('quick-add-build'));

    fireEvent.click(screen.getByText('builder-save'));

    expect(screen.queryByTestId('builder-seed')).toBeNull();
    expect(screen.getByText('steer-to-coach')).toBeTruthy(); // PlanView is back
    expect(screen.getByTestId('plan-reload').textContent).toBe('1');
  });

  it('"Ask the coach to look at it" closes the builder and sends the ask VISIBLY (W3-5)', () => {
    render(<MainTabs email={null} />);
    fireEvent.click(screen.getByLabelText('Quick add'));
    fireEvent.click(screen.getByText('quick-add-build'));

    fireEvent.click(screen.getByText('builder-ask-review'));

    // The builder is gone and the conversation holds the user's own words — the same visible
    // autoSend bridge every other steer uses, never a whispered note.
    expect(screen.queryByTestId('builder-seed')).toBeNull();
    expect(screen.getByTestId('auto-send').textContent).toBe('Can you look over my activity "Hotel HIIT"?');
  });

  it('Cancel (onClose) also lands back on the plan tab, WITHOUT bumping the reload', () => {
    render(<MainTabs email={null} />);
    fireEvent.click(screen.getByLabelText('Quick add'));
    fireEvent.click(screen.getByText('quick-add-build'));

    fireEvent.click(screen.getByText('builder-close'));

    expect(screen.queryByTestId('builder-seed')).toBeNull();
    expect(screen.getByText('steer-to-coach')).toBeTruthy();
    expect(screen.getByTestId('plan-reload').textContent).toBe('0');
  });
});
