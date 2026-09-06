import { StrictMode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import {
  draftedNote,
  recoverIfAlreadyCommitted,
  useBuildPlan,
  RECOVER_WINDOW_MS,
  SERVER_BUILD_CEILING_MS,
  STAGE_NOTES,
} from './useBuildPlan.ts';

const lockPlan = vi.fn();
const getPlan = vi.fn();
const getBuildRun = vi.fn();

vi.mock('../../lib/api.ts', () => ({
  lockPlan: (...a: unknown[]) => lockPlan(...a),
  getPlan: (...a: unknown[]) => getPlan(...a),
  getBuildRun: (...a: unknown[]) => getBuildRun(...a),
}));

/** The run record's shape, as GET /plan/build reports it. */
const running = (stage: string, drafted?: { done: number; total: number; title?: string }) => ({
  ok: true,
  committed: false,
  running: { stage, startedAt: new Date().toISOString(), ...(drafted ? { drafted } : {}) },
});
const committed = { ok: true, committed: true };

beforeEach(() => {
  vi.clearAllMocks();
  // 202: the run is CLAIMED, not finished. Completion arrives through the poll.
  lockPlan.mockResolvedValue({ status: 202, body: { running: true } });
  getPlan.mockResolvedValue({ stage: 'in_progress' });
  getBuildRun.mockResolvedValue(committed);
});

/**
 * These run under StrictMode on purpose. `main.tsx` mounts the app inside it, so in development
 * every effect is invoked, cleaned up, and invoked again — which is exactly the shape that can
 * either start someone's build twice or, worse, leave the build screen spinning forever on a
 * sequence that quietly aborted itself.
 *
 * The build no longer rides on any request this client holds open: POST /plan/lock answers 202
 * once the durable run is claimed, and GET /plan/build is the only thing that ever says it
 * finished. Leaving the app mid-build is therefore ordinary rather than exceptional.
 */
describe('useBuildPlan under StrictMode', () => {
  it('starts the build once and finishes when the run reports a committed plan', async () => {
    const onDone = vi.fn();
    const { result } = renderHook(() => useBuildPlan({ onDone }), { wrapper: StrictMode });

    await waitFor(() => expect(result.current.phase).toBe('done'));
    expect(lockPlan).toHaveBeenCalledTimes(1);
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('surfaces a too-much-at-once verdict as something they can act on', async () => {
    lockPlan.mockResolvedValue({ status: 409, body: { status: 'needs_focus' } });
    const { result } = renderHook(() => useBuildPlan({ onDone: vi.fn() }), { wrapper: StrictMode });

    await waitFor(() => expect(result.current.phase).toBe('failed'));
    expect(result.current.error).toMatch(/lot to carry at once/);
  });

  it('routes to the plan when the build already landed server-side', async () => {
    lockPlan.mockResolvedValue({ status: 422, body: {} });
    getPlan.mockResolvedValue({ stage: 'committed' });
    const onDone = vi.fn();
    const { result } = renderHook(() => useBuildPlan({ onDone }), { wrapper: StrictMode });

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(result.current.phase).not.toBe('failed');
  });

  /** A veto reaches the client through the RECORD now, in the server's own words. */
  it('shows a failure the run recorded rather than a generic apology', async () => {
    getBuildRun.mockResolvedValue({ ok: true, committed: false, failed: { message: 'Too many goals at once.' } });
    const { result } = renderHook(() => useBuildPlan({ onDone: vi.fn(), recoverEveryMs: 2 }), { wrapper: StrictMode });

    await waitFor(() => expect(result.current.phase).toBe('failed'));
    expect(result.current.error).toBe('Too many goals at once.');
  });

  /**
   * The doom-scroll contract: the POST dies on the phone's side, but it may already have claimed
   * the run. That is UNKNOWN, not failure — only the record can say, so the poll is what decides.
   */
  it('polls its way to done when the start request dies but the run was claimed', async () => {
    lockPlan.mockRejectedValue(new Error('app backgrounded — connection lost'));
    getBuildRun.mockResolvedValueOnce(running('drafting')).mockResolvedValue(committed);
    const onDone = vi.fn();
    const { result } = renderHook(() => useBuildPlan({ onDone, recoverEveryMs: 2 }), { wrapper: StrictMode });

    await waitFor(() => expect(onDone).toHaveBeenCalledTimes(1));
    expect(result.current.phase).toBe('done');
  });

  it('fails, then retries from the top without double-starting the first attempt', async () => {
    getBuildRun.mockResolvedValue({ ok: true, committed: false });
    const { result } = renderHook(() => useBuildPlan({ onDone: vi.fn(), recoverEveryMs: 2, recoverWindowMs: 20 }), {
      wrapper: StrictMode,
    });

    await waitFor(() => expect(result.current.phase).toBe('failed'));
    getBuildRun.mockResolvedValue(committed);
    result.current.retry();

    await waitFor(() => expect(result.current.phase).toBe('done'));
    expect(lockPlan).toHaveBeenCalledTimes(2);
  });

  it('collects a plan that finished while the app was away', async () => {
    getBuildRun.mockResolvedValue(running('coordinating'));
    const onDone = vi.fn();
    const { result } = renderHook(() => useBuildPlan({ onDone, recoverEveryMs: 5_000 }), { wrapper: StrictMode });
    await waitFor(() => expect(result.current.stage).toBe('coordinating'));

    getBuildRun.mockResolvedValue(committed); // it landed while they were elsewhere
    document.dispatchEvent(new Event('visibilitychange'));

    await waitFor(() => expect(result.current.phase).toBe('done'));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('a resume that finds nothing yet leaves the build alone', async () => {
    getBuildRun.mockResolvedValue(running('drafting'));
    const onDone = vi.fn();
    const { result } = renderHook(() => useBuildPlan({ onDone, recoverEveryMs: 5_000 }), { wrapper: StrictMode });
    await waitFor(() => expect(getBuildRun).toHaveBeenCalled());

    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 10));

    expect(result.current.phase).toBe('building');
    expect(onDone).not.toHaveBeenCalled();
  });

  it('onDone fires once when the poll and the resume check finish together', async () => {
    const onDone = vi.fn();
    renderHook(() => useBuildPlan({ onDone, recoverEveryMs: 2 }), { wrapper: StrictMode });

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

/**
 * What the screen actually says while it waits. These are the lines someone reads for up to ten
 * minutes, so the mapping from a real server stage to a sentence gets a table — a stage that
 * silently fell through to the wrong line would be invisible in every test that only checks
 * "is it still building".
 */
describe('what the coach says she is doing', () => {
  it('names the goal once one has actually been worked out', () => {
    expect(draftedNote({ done: 1, total: 3, title: 'Running three times a week' })).toMatch(
      /worked out running three times a week/i,
    );
  });

  it('counts down what is left rather than counting up what is done', () => {
    expect(draftedNote({ done: 1, total: 3, title: 'Running' })).toMatch(/2 to go/);
    expect(draftedNote({ done: 3, total: 3, title: 'Running' })).not.toMatch(/to go/);
  });

  it('falls back to the plain drafting line before anything has landed', () => {
    expect(draftedNote({ done: 0, total: 3 })).toBe(STAGE_NOTES.drafting);
    expect(draftedNote(undefined)).toBe(STAGE_NOTES.drafting);
  });

  it('reports the stage and the count the run is actually in', async () => {
    getBuildRun.mockResolvedValue(running('drafting', { done: 2, total: 3, title: 'Strength' }));
    const { result } = renderHook(() => useBuildPlan({ onDone: vi.fn(), recoverEveryMs: 5_000 }), {
      wrapper: StrictMode,
    });

    await waitFor(() => expect(result.current.stage).toBe('drafting'));
    expect(result.current.drafted).toEqual({ done: 2, total: 3, title: 'Strength' });
    expect(result.current.note).toMatch(/worked out strength/i);
  });

  /** The bar's one hard promise: it cannot say "finished" before a plan exists. */
  it('never shows a full bar until the plan is actually committed', async () => {
    getBuildRun.mockResolvedValue(running('saving'));
    const { result } = renderHook(() => useBuildPlan({ onDone: vi.fn(), recoverEveryMs: 5_000 }), {
      wrapper: StrictMode,
    });

    await waitFor(() => expect(result.current.stage).toBe('saving'));
    expect(result.current.progress).toBeLessThan(1);

    getBuildRun.mockResolvedValue(committed);
    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(result.current.progress).toBe(1));
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

/**
 * The window shipped SHORTER than the build it was waiting for, and the arithmetic is the whole
 * bug: the deadline starts when the client starts watching, not when the build does, so five
 * minutes could expire while a six-and-a-half-minute build was still running perfectly well.
 * Nothing throws when this is wrong — the user is simply told the build failed over a plan that
 * committed fine — so it gets a table of floors rather than one assertion.
 */
describe('the recover window outwaits the build it is waiting for', () => {
  const FASTEST_OBSERVED_BUILD_MS = 390_000; // 6m30s end to end, 2026-09-05 — the FAST end
  const OLD_TOO_SHORT_WINDOW_MS = 5 * 60_000; // what shipped, and lied about the case above

  /**
   * The server ceiling is the binding floor, not any measured build. Individual phases have run
   * to 563s (draft) and 510s (reduce), so a build unlucky in both would exceed `maxDuration`
   * anyway — past that there is genuinely nothing to collect and waiting longer is theatre.
   */
  it.each([
    ['the server ceiling, past which nothing is left to collect', SERVER_BUILD_CEILING_MS],
    ['the fastest build ever observed, let alone a median one', FASTEST_OBSERVED_BUILD_MS],
    ['the window that shipped too short', OLD_TOO_SHORT_WINDOW_MS],
  ])('waits longer than %s', (_label, floor) => {
    expect(RECOVER_WINDOW_MS).toBeGreaterThan(floor);
  });

  /** The near-miss: outwaiting the server must not mean never giving up. */
  it('still reports failure once the window is genuinely spent', async () => {
    getBuildRun.mockResolvedValue({ ok: true, committed: false });
    const { result } = renderHook(() => useBuildPlan({ onDone: vi.fn(), recoverEveryMs: 2, recoverWindowMs: 20 }), {
      wrapper: StrictMode,
    });

    await waitFor(() => expect(result.current.phase).toBe('failed'));
    expect(result.current.error).toMatch(/went wrong on my end/);
  });
});
