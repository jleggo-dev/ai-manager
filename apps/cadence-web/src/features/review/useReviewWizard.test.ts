import { act, renderHook, waitFor } from '@testing-library/react';
import { recoverIfAlreadyCommitted, useReviewWizard } from './useReviewWizard.ts';

const getReview = vi.fn();
const getPlan = vi.fn();

vi.mock('../../lib/api.ts', () => ({
  getReview: (...args: unknown[]) => getReview(...args),
  getPlan: (...args: unknown[]) => getPlan(...args),
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

describe('useReviewWizard', () => {
  it('loads review data on mount', async () => {
    const { result } = renderHook(() => useReviewWizard({ onBack: vi.fn() }));
    await waitFor(() => expect(result.current.data).toEqual(emptyReview));
  });

  it('steps forward through the order and exits via onBack from the first step', async () => {
    const onBack = vi.fn();
    const { result } = renderHook(() => useReviewWizard({ onBack }));
    await waitFor(() => expect(result.current.data).not.toBeNull());

    expect(result.current.step).toBe('goals');
    act(() => result.current.back());
    expect(onBack).toHaveBeenCalledOnce();

    act(() => result.current.next());
    expect(result.current.step).toBe('you');
    act(() => result.current.back());
    expect(result.current.step).toBe('goals');
  });
});
