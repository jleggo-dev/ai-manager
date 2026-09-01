import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CHECKIN_ADJUSTMENT_OPTIONS } from '@cadence/shared';
import { PlanView } from './PlanView.tsx';

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

const PLAN = {
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
vi.mock('./useProposalAccept.ts', () => ({
  useProposalAccept: () => ({
    note: '',
    setNote: vi.fn(),
    proposalBusy: false,
    working: null,
    acceptProp: vi.fn(),
    dismissProp: vi.fn(),
  }),
}));
vi.mock('../coach/coachFaceContext.ts', () => ({ useCoachFace: () => ({ faceId: null, face: null }) }));

vi.mock('./AdjustSheet.tsx', () => ({ AdjustSheet: () => <div data-testid="adjust-sheet" /> }));
vi.mock('./OccurrenceSheet.tsx', () => ({ OccurrenceSheet: () => null }));
vi.mock('./StartSheet.tsx', () => ({ StartSheet: () => null }));
vi.mock('./CaptureSheet.tsx', () => ({ CaptureSheet: () => null }));
vi.mock('./CookSheet.tsx', () => ({ CookSheet: () => null }));
vi.mock('./PlanProposalBanner.tsx', () => ({ PlanProposalBanner: () => null, PlanAdjustNote: () => null }));
vi.mock('./PlanSkeleton.tsx', () => ({ PlanSkeleton: () => null }));
vi.mock('./DetourBar.tsx', () => ({ DetourBar: () => null }));
vi.mock('./DetourStateSheet.tsx', () => ({ DetourStateSheet: () => null }));
vi.mock('./DetourSetup.tsx', () => ({ DetourSetup: () => null }));
vi.mock('./EndOfTrailCard.tsx', () => ({ EndOfTrail: () => null }));
vi.mock('./HorizonEndCap.tsx', () => ({ HorizonEndCap: () => null }));
vi.mock('../today/TodayTrail.tsx', () => ({ TodayTrail: () => null }));
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
});

describe('PlanView — check-in picks route to the coach', () => {
  it("'Make it lighter' hands the pick's exact steer to the coach, and no sheet opens", async () => {
    const onSteerCoach = renderPlan();
    const lighter = CHECKIN_ADJUSTMENT_OPTIONS.find((o) => o.code === 'lighter')!;

    fireEvent.click(screen.getByText('Make it lighter'));
    expect(sendDailyCheckin).toHaveBeenCalledWith({ adjustment: 'lighter' });

    // The pick shows its reply beat, then routes (the 600ms handoff in DailyCheckIn).
    await waitFor(() => expect(onSteerCoach).toHaveBeenCalledTimes(1), { timeout: 2000 });
    expect(onSteerCoach).toHaveBeenCalledWith(lighter.steer);
    expect(screen.queryByTestId('adjust-sheet')).toBeNull();
  });

  it("'Keep the week as is' ends there — nothing routes anywhere", async () => {
    const onSteerCoach = renderPlan();

    fireEvent.click(screen.getByText('Keep the week as is'));
    expect(sendDailyCheckin).toHaveBeenCalledWith({ adjustment: 'keep' });

    // Give the handoff timer more than its 600ms — it must never fire for 'keep'.
    await new Promise((r) => setTimeout(r, 750));
    expect(onSteerCoach).not.toHaveBeenCalled();
    expect(screen.queryByTestId('adjust-sheet')).toBeNull();
  });
});
