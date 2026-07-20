import { act, renderHook, waitFor } from '@testing-library/react';
import { recoverIfAlreadyCommitted, useReviewWizard } from './useReviewWizard.ts';

const getReview = vi.fn();
const getPlan = vi.fn();
const confirmGoals = vi.fn();
const previewPlan = vi.fn();
const lockPlan = vi.fn();
const dismissPlanPreview = vi.fn();

vi.mock('../../lib/api.ts', () => ({
  getReview: (...args: unknown[]) => getReview(...args),
  getPlan: (...args: unknown[]) => getPlan(...args),
  confirmGoals: (...args: unknown[]) => confirmGoals(...args),
  previewPlan: (...args: unknown[]) => previewPlan(...args),
  lockPlan: (...args: unknown[]) => lockPlan(...args),
  dismissPlanPreview: (...args: unknown[]) => dismissPlanPreview(...args),
}));

const emptyReview = {
  goals: [],
  equipment: [],
  baseline: { constraints: [], preferences: {} },
  name: 'Sam',
};

beforeEach(() => {
  vi.clearAllMocks();
  getReview.mockResolvedValue(emptyReview);
  dismissPlanPreview.mockResolvedValue(undefined);
});

describe('recoverIfAlreadyCommitted', () => {
  it('calls onLocked and returns true when the plan is already committed', async () => {
    getPlan.mockResolvedValue({ stage: 'committed' });
    const onLocked = vi.fn();
    await expect(recoverIfAlreadyCommitted(onLocked)).resolves.toBe(true);
    expect(onLocked).toHaveBeenCalledOnce();
  });

  it('returns false when the plan is not committed or getPlan fails', async () => {
    getPlan.mockResolvedValue({ stage: 'draft' });
    await expect(recoverIfAlreadyCommitted(vi.fn())).resolves.toBe(false);

    getPlan.mockRejectedValue(new Error('network'));
    const onLocked = vi.fn();
    await expect(recoverIfAlreadyCommitted(onLocked)).resolves.toBe(false);
    expect(onLocked).not.toHaveBeenCalled();
  });
});

describe('useReviewWizard — preview / lock state machine', () => {
  it('loads review data on mount', async () => {
    const { result } = renderHook(() => useReviewWizard({ mode: 'onboard', onBack: vi.fn(), onLocked: vi.fn() }));
    await waitFor(() => expect(result.current.data).toEqual(emptyReview));
  });

  it('doPreview sets the proposal on success', async () => {
    const proposal = { activities: [{ title: 'Walk' }], note: 'Soft start' };
    confirmGoals.mockResolvedValue(undefined);
    previewPlan.mockResolvedValue({ status: 'proposed', proposal });

    const { result } = renderHook(() => useReviewWizard({ mode: 'onboard', onBack: vi.fn(), onLocked: vi.fn() }));
    await waitFor(() => expect(result.current.data).not.toBeNull());

    await act(async () => {
      await result.current.doPreview();
    });

    expect(result.current.preview).toEqual(proposal);
    expect(result.current.msg).toBe('');
  });

  it('doPreview surfaces the needs_focus coach message', async () => {
    confirmGoals.mockResolvedValue(undefined);
    previewPlan.mockResolvedValue({ status: 'needs_focus' });

    const { result } = renderHook(() => useReviewWizard({ mode: 'onboard', onBack: vi.fn(), onLocked: vi.fn() }));
    await waitFor(() => expect(result.current.data).not.toBeNull());

    await act(async () => {
      await result.current.doPreview();
    });

    expect(result.current.preview).toBeNull();
    expect(result.current.msg).toMatch(/pick the few that matter most/);
  });

  it('doPreview recovers when the plan is already committed after a failed preview', async () => {
    confirmGoals.mockResolvedValue(undefined);
    previewPlan.mockResolvedValue({ status: 'error', violations: ['no confirmed goals'] });
    getPlan.mockResolvedValue({ stage: 'committed' });
    const onLocked = vi.fn();

    const { result } = renderHook(() => useReviewWizard({ mode: 'onboard', onBack: vi.fn(), onLocked }));
    await waitFor(() => expect(result.current.data).not.toBeNull());

    await act(async () => {
      await result.current.doPreview();
    });

    expect(onLocked).toHaveBeenCalledOnce();
  });

  it('doConfirmLock advances via onLocked after a successful lock', async () => {
    lockPlan.mockResolvedValue({ status: 200, body: { activities: 3 } });
    const onLocked = vi.fn();

    const { result } = renderHook(() => useReviewWizard({ mode: 'onboard', onBack: vi.fn(), onLocked }));
    await waitFor(() => expect(result.current.data).not.toBeNull());

    // Fake timers only after mount settled — waitFor needs real timers.
    vi.useFakeTimers();
    try {
      await act(async () => {
        await result.current.doConfirmLock();
      });

      expect(result.current.msg).toMatch(/3 things on your week/);
      expect(result.current.preview).toBeNull();

      await act(async () => {
        vi.advanceTimersByTime(900);
      });
      expect(onLocked).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
});
