import { StrictMode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { useBuildPlan } from './useBuildPlan.ts';

const confirmGoals = vi.fn();
const previewPlan = vi.fn();
const lockPlan = vi.fn();
const getPlan = vi.fn();

vi.mock('../../lib/api.ts', () => ({
  confirmGoals: (...a: unknown[]) => confirmGoals(...a),
  previewPlan: (...a: unknown[]) => previewPlan(...a),
  lockPlan: (...a: unknown[]) => lockPlan(...a),
  getPlan: (...a: unknown[]) => getPlan(...a),
}));

beforeEach(() => {
  vi.clearAllMocks();
  confirmGoals.mockResolvedValue({ confirmed: 2 });
  previewPlan.mockResolvedValue({ status: 'proposed', proposal: { activities: [], note: '' } });
  lockPlan.mockResolvedValue({ status: 200, body: { activities: 3 } });
  getPlan.mockResolvedValue({ stage: 'in_progress' });
});

/**
 * These run under StrictMode on purpose. `main.tsx` mounts the app inside it, so in development
 * every effect is invoked, cleaned up, and invoked again — which is exactly the shape that can
 * either commit someone's plan twice or, worse, leave the build screen spinning forever on a
 * sequence that quietly aborted itself.
 */
describe('useBuildPlan under StrictMode', () => {
  it('builds the week exactly once and finishes', async () => {
    const onDone = vi.fn();
    const { result } = renderHook(() => useBuildPlan({ onDone }), { wrapper: StrictMode });

    await waitFor(() => expect(result.current.phase).toBe('done'));
    expect(confirmGoals).toHaveBeenCalledTimes(1);
    expect(lockPlan).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('surfaces a too-much-at-once preview as something they can act on', async () => {
    previewPlan.mockResolvedValue({ status: 'needs_focus' });
    const { result } = renderHook(() => useBuildPlan({ onDone: vi.fn() }), { wrapper: StrictMode });

    await waitFor(() => expect(result.current.phase).toBe('failed'));
    expect(result.current.error).toMatch(/lot to carry at once/);
    expect(lockPlan).not.toHaveBeenCalled();
  });

  it('routes to the plan when the lock already landed server-side', async () => {
    lockPlan.mockResolvedValue({ status: 409, body: {} });
    getPlan.mockResolvedValue({ stage: 'committed' });
    const onDone = vi.fn();
    const { result } = renderHook(() => useBuildPlan({ onDone }), { wrapper: StrictMode });

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(result.current.phase).not.toBe('failed');
  });

  it('retries from the top without double-committing the first attempt', async () => {
    previewPlan.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useBuildPlan({ onDone: vi.fn() }), { wrapper: StrictMode });

    await waitFor(() => expect(result.current.phase).toBe('failed'));
    result.current.retry();

    await waitFor(() => expect(result.current.phase).toBe('done'));
    expect(confirmGoals).toHaveBeenCalledTimes(2);
    expect(lockPlan).toHaveBeenCalledTimes(1);
  });

  it('does nothing at all until told to run', async () => {
    renderHook(() => useBuildPlan({ onDone: vi.fn(), run: false }), { wrapper: StrictMode });
    await new Promise((r) => setTimeout(r, 10));
    expect(confirmGoals).not.toHaveBeenCalled();
  });
});
