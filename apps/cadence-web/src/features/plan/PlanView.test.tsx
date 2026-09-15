import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CHECKIN_ADJUSTMENT_OPTIONS } from '@cadence/shared';
import { PlanView } from './PlanView.tsx';
import { __clearRevealedForTests, PULL_REVEAL_PX } from './proposalShelf.ts';

/**
 * The daily check-in's adjustment picks are preformed steers — small asks, exactly what the
 * coach's triage exists for (Phase 2, PLAN-CHANGES.md). These tests pin the ROUTING: a pick goes
 * out through `onSteerCoach` (MainTabs' visible autoSend bridge) in the pick's exact words, and
 * the adjust sheet — the old road to the direct synthesis pipeline — never opens for it.
 *
 * The real DailyCheckIn is rendered; everything else on the plan surface is stubbed.
 */
const sendDailyCheckin = vi.fn();
vi.mock('../../lib/api.ts', () => ({
  endEpisode: vi.fn(),
  checkin: vi.fn(),
  enterEpisode: vi.fn(),
  postponeDetour: vi.fn(),
  sendDetourEquipment: vi.fn(),
  sendGymPhotos: vi.fn(),
  sendDailyCheckin: (...a: unknown[]) => sendDailyCheckin(...a),
}));

const PLAN: {
  hasPlan: boolean;
  version: number;
  streak: { current: number };
  pendingProposal: { reason: string; suggested_levers: string[]; created_at: string; action?: string } | null;
  activeEpisode: null;
  week: { date: string; occurrences: never[] }[];
} = {
  hasPlan: true,
  version: 3,
  streak: { current: 2 },
  pendingProposal: null,
  activeEpisode: null,
  week: [{ date: '2026-08-31', occurrences: [] }],
};
vi.mock('../../lib/query/index.ts', () => ({
  usePlan: () => ({ data: PLAN, error: null, refetch: vi.fn().mockResolvedValue(undefined) }),
  setPlanData: vi.fn(),
  useWatchSync: vi.fn(),
  useWatchLogInbox: vi.fn(),
  useWatchPortraitSync: vi.fn(),
  useDailyCheckinDue: () => true,
}));
vi.mock('@tanstack/react-query', () => ({ useQueryClient: () => ({}) }));
/** The Phase 0 recovery watch's state, per test — `working` true = a background run is live. */
const accept = vi.hoisted(() => ({ working: false }));
vi.mock('./useProposalAccept.ts', () => ({
  useProposalAccept: () => ({
    note: '',
    setNote: vi.fn(),
    proposalBusy: false,
    working: accept.working,
    acceptProp: vi.fn(),
    dismissProp: vi.fn(),
  }),
}));
vi.mock('../coach/coachFaceContext.ts', () => ({ useCoachFace: () => ({ faceId: null, face: null }) }));

vi.mock('./AdjustSheet.tsx', () => ({ AdjustSheet: () => <div data-testid="adjust-sheet" /> }));
vi.mock('./StartSheet.tsx', () => ({ StartSheet: () => null }));
vi.mock('./CaptureSheet.tsx', () => ({ CaptureSheet: () => null }));
vi.mock('./CookSheet.tsx', () => ({ CookSheet: () => null }));
vi.mock('./PlanProposalBanner.tsx', () => ({
  PlanProposalBanner: () => <div data-testid="proposal-banner" />,
  PlanAdjustNote: () => null,
}));
vi.mock('./PlanSkeleton.tsx', () => ({ PlanSkeleton: () => null }));
vi.mock('./DetourBar.tsx', () => ({ DetourBar: () => null }));
vi.mock('./DetourStateSheet.tsx', () => ({ DetourStateSheet: () => null }));
vi.mock('./DetourSetup.tsx', () => ({ DetourSetup: () => null }));
vi.mock('./EndOfTrailCard.tsx', () => ({ EndOfTrail: () => null }));
vi.mock('./HorizonEndCap.tsx', () => ({ HorizonEndCap: () => null }));
vi.mock('../today/TodayTrail.tsx', () => ({ TodayTrail: () => null }));
vi.mock('../today/useDaySkies.ts', () => ({ useDaySkies: () => ({}) }));
vi.mock('../today/TrailHeader.tsx', () => ({ TrailHeader: () => null }));

function renderPlan(onSteerCoach = vi.fn()) {
  render(
    <PlanView
      onCoach={vi.fn()}
      onSteerCoach={onSteerCoach}
      onOpenFood={vi.fn()}
      onStartCheckIn={vi.fn()}
      onPlanAhead={vi.fn()}
    />,
  );
  return onSteerCoach;
}

beforeEach(() => {
  vi.clearAllMocks();
  accept.working = false;
  PLAN.pendingProposal = null;
});

describe('PlanView — check-in picks route to the coach', () => {
  it("'Make it lighter' hands the pick's exact steer to the coach, and no sheet opens", async () => {
    const onSteerCoach = renderPlan();
    const lighter = CHECKIN_ADJUSTMENT_OPTIONS.find((o) => o.code === 'lighter')!;

    fireEvent.click(screen.getByText('Make it lighter'));
    // Nothing is sent on the pick — the one button commits it (owner, 2026-09-08).
    expect(sendDailyCheckin).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(sendDailyCheckin).toHaveBeenCalledWith({ mood: null, adjustment: 'lighter' });

    await waitFor(() => expect(onSteerCoach).toHaveBeenCalledTimes(1));
    expect(onSteerCoach).toHaveBeenCalledWith(lighter.steer);
    expect(screen.queryByTestId('adjust-sheet')).toBeNull();
  });

  it("'Keep the week as is' ends there — nothing routes anywhere", async () => {
    const onSteerCoach = renderPlan();

    fireEvent.click(screen.getByText('Keep the week as is'));
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(sendDailyCheckin).toHaveBeenCalledWith({ mood: null, adjustment: 'keep' });

    await waitFor(() => expect(screen.queryByText('Keep the week as is')).toBeNull());
    expect(onSteerCoach).not.toHaveBeenCalled();
    expect(screen.queryByTestId('adjust-sheet')).toBeNull();
  });
});

/**
 * The run line (Phase 3, PLAN-CHANGES.md): while a background rebuild runs, PlanView itself used
 * to show nothing — only the Adjust sheet or the proposal banner knew. `working` is the Phase 0
 * recovery watch (useProposalAccept — mount + resume pending checks, polled to resolution); the
 * line renders that state and nothing else, so its lifecycle IS the watch's, already pinned in
 * useProposalAccept.test.tsx. What's pinned here: it shows, it hides, and it yields to the banner.
 */
describe('PlanView — the background-run line', () => {
  const line = () => document.querySelector('.plan-runline');

  it('shows one slim line while a background rebuild is running', () => {
    accept.working = true;
    renderPlan();
    expect(line()?.textContent).toContain('Your week is being redrawn');
    expect(line()?.getAttribute('role')).toBe('status');
  });

  it('shows nothing when no run is live', () => {
    renderPlan();
    expect(line()).toBeNull();
  });

  it('yields to the proposal banner — the louder surface owns a live proposal', () => {
    accept.working = true;
    PLAN.pendingProposal = { reason: 'A rough week', suggested_levers: [], created_at: '2026-08-31' };
    renderPlan();
    expect(line()).toBeNull();
  });
});

/**
 * The shelf (owner, 2026-09-14): "When I go to the plan, I immediately see the disrupted ask,
 * which should only display if I deliberately pull down." The app's own absence-noticed asks
 * ("Life happened?", "Welcome back") wait above the trail; a pull from the top, or a tap on the
 * grip, brings them out. The coach's own suggestion never waits.
 */
describe('PlanView — the shelf', () => {
  const proposal = (action?: string) => ({
    reason: 'Welcome back. Want to ease in with a short detour while you find your rhythm again?',
    suggested_levers: [],
    created_at: '2026-09-13T16:10:15.584Z',
    ...(action ? { action } : {}),
  });
  const pane = () => document.querySelector('.scrollbody') as HTMLElement;
  const grip = () => screen.queryByRole('button', { name: /pull down for a note/i });
  const banner = () => screen.queryByTestId('proposal-banner');

  beforeEach(() => __clearRevealedForTests());

  it("'Life happened?' waits on the shelf, and a pull down from the top brings it out", () => {
    PLAN.pendingProposal = proposal('enter_disrupted');
    renderPlan();
    expect(banner()).toBeNull();
    expect(grip()).not.toBeNull();

    fireEvent.touchStart(pane(), { touches: [{ clientY: 100 }] });
    // A scroll's worth of travel is not the pull.
    fireEvent.touchMove(pane(), { touches: [{ clientY: 100 + PULL_REVEAL_PX - 1 }] });
    expect(banner()).toBeNull();
    fireEvent.touchMove(pane(), { touches: [{ clientY: 100 + PULL_REVEAL_PX }] });
    expect(banner()).not.toBeNull();
    expect(grip()).toBeNull();
  });

  it("'Welcome back' (the re-baseline offer) waits the same way, and a tap on the grip is the same answer", () => {
    PLAN.pendingProposal = proposal('rebaseline');
    renderPlan();
    expect(banner()).toBeNull();
    fireEvent.click(grip()!);
    expect(banner()).not.toBeNull();
  });

  it('a pull that starts with the trail scrolled down is a scroll, not the reveal', () => {
    PLAN.pendingProposal = proposal('enter_disrupted');
    renderPlan();
    Object.defineProperty(pane(), 'scrollTop', { value: 40, configurable: true });
    fireEvent.touchStart(pane(), { touches: [{ clientY: 100 }] });
    fireEvent.touchMove(pane(), { touches: [{ clientY: 100 + PULL_REVEAL_PX * 2 }] });
    expect(banner()).toBeNull();
  });

  it.each([
    ["the coach's own suggestion ('replan') shows itself, with no grip", 'replan'],
    ['an older proposal with no action (which means replan) shows itself', undefined],
  ])('%s', (_label, action) => {
    PLAN.pendingProposal = proposal(action);
    renderPlan();
    expect(banner()).not.toBeNull();
    expect(grip()).toBeNull();
  });
});
