import { StrictMode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { recoverIfAlreadyCommitted, useBuildPlan } from './useBuildPlan.ts';

const lockPlan = vi.fn();
const getPlan = vi.fn();

vi.mock('../../lib/api.ts', () => ({
  lockPlan: (...a: unknown[]) => lockPlan(...a),
  getPlan: (...a: unknown[]) => getPlan(...a),
}));

beforeEach(() => {
  vi.clearAllMocks();
  lockPlan.mockResolvedValue({ status: 200, body: { activities: 3 } });
  getPlan.mockResolvedValue({ stage: 'in_progress' });
});

/**
 * These run under StrictMode on purpose. `main.tsx` mounts the app inside it, so in development
 * every effect is invoked, cleaned up, and invoked again — which is exactly the shape that can
 * either commit someone's plan twice or, worse, leave the build screen spinning forever on a
 * sequence that quietly aborted itself.
 *
 * The hook is now ONE self-sufficient server call (lockPlan confirms + synthesizes + commits),
 * so leaving the app mid-build is safe: a dead fetch polls for the committed plan instead of
 * declaring failure. That poll path is the doom-scroll contract and gets its own test.
 */
describe('useBuildPlan under StrictMode', () => {
  it('builds the week with exactly one lock call and finishes', async () => {
    const onDone = vi.fn();
    const { result } = renderHook(() => useBuildPlan({ onDone }), { wrapper: StrictMode });

    await waitFor(() => expect(result.current.phase).toBe('done'));
    expect(lockPlan).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('surfaces a too-much-at-once verdict as something they can act on', async () => {
    lockPlan.mockResolvedValue({ status: 422, body: { status: 'needs_focus' } });
    const { result } = renderHook(() => useBuildPlan({ onDone: vi.fn() }), { wrapper: StrictMode });

    await waitFor(() => expect(result.current.phase).toBe('failed'));
    expect(result.current.error).toMatch(/lot to carry at once/);
  });

  it('routes to the plan when the lock already landed server-side', async () => {
    lockPlan.mockResolvedValue({ status: 409, body: {} });
    getPlan.mockResolvedValue({ stage: 'committed' });
    const onDone = vi.fn();
    const { result } = renderHook(() => useBuildPlan({ onDone }), { wrapper: StrictMode });

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(result.current.phase).not.toBe('failed');
  });

  /**
   * The doom-scroll contract: the user backgrounds the app, iOS kills the fetch, the SERVER
   * keeps building. Coming back must find the finished week — a dead connection polls for the
   * committed plan rather than reporting a failure that didn't happen.
   */
  it('polls its way to done when the fetch dies but the server finishes the build', async () => {
    lockPlan.mockRejectedValue(new Error('app backgrounded — connection lost'));
    getPlan.mockResolvedValueOnce({ stage: 'in_progress' }).mockResolvedValue({ stage: 'committed' });
    const onDone = vi.fn();
    const { result } = renderHook(() => useBuildPlan({ onDone, recoverEveryMs: 5 }), { wrapper: StrictMode });

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(result.current.phase).toBe('done');
    expect(lockPlan).toHaveBeenCalledTimes(1);
  });

  it('fails, then retries from the top without double-committing the first attempt', async () => {
    lockPlan.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useBuildPlan({ onDone: vi.fn(), recoverEveryMs: 5, recoverWindowMs: 20 }), {
      wrapper: StrictMode,
    });

    await waitFor(() => expect(result.current.phase).toBe('failed'));
    result.current.retry();

    await waitFor(() => expect(result.current.phase).toBe('done'));
    expect(lockPlan).toHaveBeenCalledTimes(2);
  });

  /**
   * The real phone failure, and the one the poll test above cannot reach: iOS suspends the
   * webview and the in-flight fetch NEVER settles — no resolve, no reject — so the catch that
   * owns the poll is never entered and the build screen spins over a week that finished minutes
   * ago. Coming back is the signal.
   */
  it('collects a plan that finished while the app was away, on a fetch that never settles', async () => {
    lockPlan.mockImplementation(() => new Promise(() => {}));
    const onDone = vi.fn();
    const { result } = renderHook(() => useBuildPlan({ onDone }), { wrapper: StrictMode });
    await waitFor(() => expect(lockPlan).toHaveBeenCalled());
    expect(result.current.phase).toBe('building');

    getPlan.mockResolvedValue({ stage: 'committed' }); // it landed while they were elsewhere
    document.dispatchEvent(new Event('visibilitychange'));

    await waitFor(() => expect(result.current.phase).toBe('done'));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('a resume that finds nothing yet leaves the build alone', async () => {
    lockPlan.mockImplementation(() => new Promise(() => {}));
    const onDone = vi.fn();
    const { result } = renderHook(() => useBuildPlan({ onDone }), { wrapper: StrictMode });
    await waitFor(() => expect(lockPlan).toHaveBeenCalled());

    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 10));

    expect(result.current.phase).toBe('building');
    expect(onDone).not.toHaveBeenCalled();
  });

  it('onDone fires once when the fetch and the resume check finish together', async () => {
    // Both paths racing to the same committed plan must not double-advance the app.
    getPlan.mockResolvedValue({ stage: 'committed' });
    const onDone = vi.fn();
    renderHook(() => useBuildPlan({ onDone }), { wrapper: StrictMode });

    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(onDone).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('does nothing at all until told to run', async () => {
    renderHook(() => useBuildPlan({ onDone: vi.fn(), run: false }), { wrapper: StrictMode });
    await new Promise((r) => setTimeout(r, 10));
    expect(lockPlan).not.toHaveBeenCalled();
  });
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
