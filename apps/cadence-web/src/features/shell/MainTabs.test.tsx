import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MainTabs } from './MainTabs.tsx';
import { writeDraft } from '../builder/draftStore.ts';

// The shell reads a held draft on mount (draftStore.ts), so each test starts on a clean device —
// otherwise one test's draft opens the next test's builder.
afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

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
// The Settings Room stub renders something identifiable (the real room is a full screen) plus its
// own `‹` exit, so the nav suite below can tell "the room is still on the glass" apart from "the
// tab content came back" — the exact distinction the trapped-in-Settings bug turned on.
vi.mock('../settings/SettingsRoom.tsx', () => ({
  SettingsRoom: ({ onBack }: { onBack: () => void }) => (
    <div data-testid="settings-room">
      <button onClick={onBack}>room-back</button>
    </div>
  ),
}));
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
    restore,
    onMinimize,
  }: {
    initial?: unknown;
    onSaved: (routine: unknown) => void;
    onClose: () => void;
    onAskReview?: (text: string) => void;
    restore?: unknown;
    onMinimize?: () => void;
  }) => (
    <div>
      <div data-testid="builder-seed">{JSON.stringify(initial ?? null)}</div>
      {/* What it was reopened FROM, so the shell's restore wiring is visible from out here. */}
      <div data-testid="builder-restore">{restore ? 'restored' : ''}</div>
      {onAskReview && (
        <button
          onClick={() => {
            // The real builder minimizes before handing the ask over, so the draft is still
            // there to apply her answer to (ActivityBuilder.tsx).
            onMinimize?.();
            onAskReview('Can you look over my activity "Hotel HIIT"?');
          }}
        >
          builder-ask-review
        </button>
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

    // The conversation holds the user's own words — the same visible autoSend bridge every other
    // steer uses, never a whispered note. The builder MINIMIZES rather than closing (2026-09-06),
    // so the draft her answer is about is one tap away.
    expect(screen.getByTestId('auto-send').textContent).toBe('Can you look over my activity "Hotel HIIT"?');
    expect(screen.getByLabelText('Back to your draft')).toBeTruthy();
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

/**
 * The tab bar is the one control that must always work, and it did not: the Settings Room gates
 * every tab branch in the shell, but the tab buttons only set `tab` — so a tap on Plan, Coach or
 * Progress swapped the hidden tab underneath and left the room on screen (owner, 2026-09-05:
 * "I click the other nav buttons and it stays on settings"). A dead nav button throws nothing and
 * looks exactly like a frozen app, so it gets the table treatment the routers get: every tab that
 * must leave the room, plus the near-misses that must NOT.
 */
describe('MainTabs — the tab bar always leaves the Settings Room', () => {
  const openSettings = () => {
    render(<MainTabs email={null} />);
    fireEvent.click(screen.getByLabelText('Settings'));
    expect(screen.getByTestId('settings-room')).toBeTruthy();
  };

  it.each([
    ['Plan', 'steer-to-coach'],
    ['Progress', null],
  ] as const)('tapping %s closes the room and shows that tab', (label, marker) => {
    openSettings();

    fireEvent.click(screen.getByText(label).closest('button')!);

    expect(screen.queryByTestId('settings-room')).toBeNull();
    expect(screen.getByText(label).closest('button')!.className).toContain('tab-on');
    if (marker) expect(screen.getByText(marker)).toBeTruthy();
  });

  it('tapping Coach closes the room and puts the conversation back on screen', () => {
    openSettings();

    fireEvent.click(screen.getByText('Coach').closest('button')!);

    expect(screen.queryByTestId('settings-room')).toBeNull();
    // The chat is kept mounted and hidden with CSS, so "showing" is `display: contents`.
    expect(screen.getByTestId('auto-send').closest('[style]')!.getAttribute('style')).toContain('contents');
    expect(screen.getByText('Coach').closest('button')!.className).toContain('tab-on');
  });

  // Near-misses: the two taps that must leave you exactly where you are.
  it('tapping Settings again keeps the room open', () => {
    openSettings();

    fireEvent.click(screen.getByLabelText('Settings'));

    expect(screen.getByTestId('settings-room')).toBeTruthy();
  });

  it("the room's own back button still closes it", () => {
    openSettings();

    fireEvent.click(screen.getByText('room-back'));

    expect(screen.queryByTestId('settings-room')).toBeNull();
    expect(screen.getByText('steer-to-coach')).toBeTruthy();
  });

  it('the bar shows Settings as current — and Plan as NOT current — while the room is open', () => {
    openSettings();

    expect(screen.getByLabelText('Settings').className).toContain('tab-on');
    expect(screen.getByText('Plan').closest('button')!.className).not.toContain('tab-on');
  });
});

/**
 * Minimize — the owner's third door (2026-09-06), and what a nav tap now does by itself.
 *
 * The earlier fix made the tab bar ask "discard or keep editing?" before letting you leave. The
 * ruling replaced the question with a better answer: nothing is lost, so nothing is asked. The
 * builder steps aside, the draft is held on disk (draftStore.ts, its own suite), and a pill brings
 * it back. Save and Discard stay deliberate acts with their own buttons.
 */
describe('MainTabs — a nav tap minimizes the builder', () => {
  const openBuilder = () => {
    render(<MainTabs email={null} />);
    fireEvent.click(screen.getByLabelText('Quick add'));
    fireEvent.click(screen.getByText('quick-add-build'));
    expect(screen.getByTestId('builder-seed')).toBeTruthy();
  };

  it.each([
    ['Coach', 'auto-send'],
    ['Progress', null],
  ] as const)('tapping %s steps the builder aside and lands there, no questions', (label, marker) => {
    openBuilder();

    fireEvent.click(screen.getByText(label).closest('button')!);

    expect(screen.getByText(label).closest('button')!.className).toContain('tab-on');
    if (marker) expect(screen.getByTestId(marker)).toBeTruthy();
    // Nothing asked, and nothing thrown away: the draft is still mounted behind the pill.
    expect(screen.queryByText('Discard this draft?')).toBeNull();
    expect(screen.getByLabelText('Back to your draft')).toBeTruthy();
  });

  it('the pill brings it back exactly where it was', () => {
    openBuilder();
    fireEvent.click(screen.getByText('Progress').closest('button')!);

    fireEvent.click(screen.getByLabelText('Back to your draft'));

    expect(screen.getByTestId('builder-seed').textContent).toBe(JSON.stringify({ name: 'Piano — mine' }));
    // Back on the glass, so the pill stands down.
    expect(screen.queryByLabelText('Back to your draft')).toBeNull();
  });

  it('the gear minimizes it too, and the draft is still reachable from inside Settings', () => {
    openBuilder();

    fireEvent.click(screen.getByLabelText('Settings'));

    expect(screen.getByTestId('settings-room')).toBeTruthy();
    // A draft you cannot get back to from where you are standing is the same trap, one screen on.
    expect(screen.getByLabelText('Back to your draft')).toBeTruthy();
  });

  // Near-misses: the two exits that END a draft must leave no pill behind.
  it.each(['builder-save', 'builder-close'])('%s closes it for good — no pill', (button) => {
    openBuilder();

    fireEvent.click(screen.getByText(button));

    expect(screen.queryByTestId('builder-seed')).toBeNull();
    expect(screen.queryByLabelText('Back to your draft')).toBeNull();
    expect(screen.getByText('Plan').closest('button')!.className).toContain('tab-on');
  });

  it('starting a NEW build over a parked draft opens the new one, not the old', () => {
    openBuilder();
    fireEvent.click(screen.getByText('Progress').closest('button')!);
    expect(screen.getByLabelText('Back to your draft')).toBeTruthy();

    // Minimizing keeps the builder MOUNTED, so this is the tap that would quietly hand back the
    // parked draft under the new pick's name if the shell reused the instance.
    fireEvent.click(screen.getByLabelText('Quick add'));
    fireEvent.click(screen.getByText('quick-add-build'));

    expect(screen.getByTestId('builder-seed').textContent).toBe(JSON.stringify({ name: 'Piano — mine' }));
    expect(screen.getByTestId('builder-restore').textContent).toBe(''); // a fresh one, not a restore
  });

  it('with no draft on the device, nothing is offered at launch', () => {
    render(<MainTabs email={null} />);

    expect(screen.queryByLabelText('Back to your draft')).toBeNull();
    expect(screen.queryByTestId('builder-seed')).toBeNull();
  });

  it('a draft left from a previous run comes back as the PILL, not as the screen', () => {
    writeDraft({
      phase: 'builder',
      family: 'practice',
      cards: [{ id: 'c1', block: { label: 'Practice', items: [{ name: 'Scales', duration_min: 10 }] } }],
      name: 'Piano — mine',
    });

    render(<MainTabs email={null} />);

    // Offered, never imposed: relaunching into someone's half-built activity would be its own hijack.
    expect(screen.getByLabelText('Back to your draft')).toBeTruthy();
    expect(screen.getByText('steer-to-coach')).toBeTruthy(); // the plan tab, as ever

    fireEvent.click(screen.getByLabelText('Back to your draft'));

    expect(screen.getByTestId('builder-restore').textContent).toBe('restored');
  });
});
