import { renderHook, waitFor } from '@testing-library/react';
import { useReplanPreview, waitingNote } from './useReplanPreview.ts';

const previewReplan = vi.fn();
const getPendingReplan = vi.fn();
const confirmGoals = vi.fn();

vi.mock('../../lib/api.ts', () => ({
  previewReplan: (...a: unknown[]) => previewReplan(...a),
  getPendingReplan: (...a: unknown[]) => getPendingReplan(...a),
  confirmGoals: (...a: unknown[]) => confirmGoals(...a),
}));

const PROPOSAL = { activities: [{ title: 'Dead hangs', cadence: '3x/week' }], note: 'Loosened the elbow guard.' };

beforeEach(() => {
  vi.clearAllMocks();
  previewReplan.mockResolvedValue({ status: 'proposed', proposal: PROPOSAL });
  getPendingReplan.mockResolvedValue({ proposal: null });
  confirmGoals.mockResolvedValue(undefined);
});

/**
 * The failure these cover, in the owner's words (2026-08-15): *"It says it's working on options …
 * it never replies."* It was replying — at 271 seconds, measured. Every test here is about the
 * four and a half minutes between the tap and the answer, and the three ways back into it.
 */
describe('useReplanPreview', () => {
  const opts = { steer: () => 'stop protecting my elbow', adoptCaptured: false };

  /**
   * Pending first, always (2026-08-31): a finished 16-activity rebalance sat invisible in
   * pending_plan because only a live Adjust flow ever looked. The hook now asks on mount, and
   * autoStart spends a synthesis only when the server holds nothing.
   */
  it('surfaces a server-side pending proposal on mount, without being started', async () => {
    getPendingReplan.mockResolvedValue({ proposal: PROPOSAL });
    const { result } = renderHook(() => useReplanPreview(opts));
    await waitFor(() => expect(result.current.proposal).toEqual(PROPOSAL));
    expect(previewReplan).not.toHaveBeenCalled();
  });

  it('autoStart shows a waiting proposal instead of synthesizing over it', async () => {
    getPendingReplan.mockResolvedValue({ proposal: PROPOSAL });
    const { result } = renderHook(() => useReplanPreview({ ...opts, autoStart: true }));
    await waitFor(() => expect(result.current.proposal).toEqual(PROPOSAL));
    expect(previewReplan).not.toHaveBeenCalled();
  });

  it('autoStart synthesizes when nothing is pending', async () => {
    const { result } = renderHook(() => useReplanPreview({ ...opts, autoStart: true }));
    await waitFor(() => expect(result.current.proposal).toEqual(PROPOSAL));
    expect(previewReplan).toHaveBeenCalledTimes(1);
  });

  it('hands back the proposal on the happy path, and passes the steer through verbatim', async () => {
    const { result } = renderHook(() => useReplanPreview(opts));
    void result.current.start();

    await waitFor(() => expect(result.current.proposal).toEqual(PROPOSAL));
    expect(previewReplan).toHaveBeenCalledWith('stop protecting my elbow');
    expect(result.current.busy).toBe(false);
  });

  it('adopts captured goals before synthesizing, and only when asked to', async () => {
    const { result } = renderHook(() => useReplanPreview({ ...opts, adoptCaptured: true }));
    void result.current.start();
    await waitFor(() => expect(result.current.proposal).toEqual(PROPOSAL));
    expect(confirmGoals).toHaveBeenCalledTimes(1);

    const plain = renderHook(() => useReplanPreview(opts));
    void plain.result.current.start();
    await waitFor(() => expect(plain.result.current.proposal).toEqual(PROPOSAL));
    expect(confirmGoals).toHaveBeenCalledTimes(1);
  });

  /** The phone backgrounded, the fetch died, the server kept synthesizing. */
  it('polls its way to the proposal when the fetch dies but the server finishes', async () => {
    previewReplan.mockRejectedValue(new Error('app backgrounded — connection lost'));
    getPendingReplan.mockResolvedValueOnce({ proposal: null }).mockResolvedValue({ proposal: PROPOSAL });

    const { result } = renderHook(() => useReplanPreview({ ...opts, recoverEveryMs: 5 }));
    void result.current.start();

    await waitFor(() => expect(result.current.proposal).toEqual(PROPOSAL));
    expect(previewReplan).toHaveBeenCalledTimes(1); // never pays for a second synthesis
  });

  /**
   * The real phone failure: iOS suspends the webview and the fetch NEVER settles — no resolve, no
   * reject — so the catch that owns the poll is never entered, and its timer isn't running
   * either. Coming back is the only signal left. Nothing looked for it before this hook.
   */
  it('collects a proposal that finished while the app was away, on a fetch that never settles', async () => {
    previewReplan.mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useReplanPreview(opts));
    void result.current.start();
    await waitFor(() => expect(result.current.busy).toBe(true));

    getPendingReplan.mockResolvedValue({ proposal: PROPOSAL }); // it landed while they were elsewhere
    document.dispatchEvent(new Event('visibilitychange'));

    await waitFor(() => expect(result.current.proposal).toEqual(PROPOSAL));
  });

  it('a resume that finds nothing yet leaves the wait alone', async () => {
    previewReplan.mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useReplanPreview(opts));
    void result.current.start();
    await waitFor(() => expect(result.current.busy).toBe(true));

    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 10));

    expect(result.current.busy).toBe(true);
    expect(result.current.error).toBe('');
  });

  it('surfaces a veto in the coach’s words rather than a generic failure', async () => {
    previewReplan.mockResolvedValue({ status: 'vetoed', violations: ['No active goals to re-plan.'] });
    const { result } = renderHook(() => useReplanPreview(opts));
    void result.current.start();

    await waitFor(() => expect(result.current.phase).toBe('failed'));
    expect(result.current.error).toBe('No active goals to re-plan.');
  });

  it('gives up only after the whole recovery window, then says so', async () => {
    previewReplan.mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useReplanPreview({ ...opts, recoverEveryMs: 5, recoverWindowMs: 20 }));
    void result.current.start();

    await waitFor(() => expect(result.current.phase).toBe('failed'));
    expect(result.current.error).toMatch(/hiccuped/);
    expect(getPendingReplan).toHaveBeenCalled();
  });

  it('will not start a second synthesis on top of one already running', async () => {
    previewReplan.mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useReplanPreview(opts));
    void result.current.start();
    await waitFor(() => expect(result.current.busy).toBe(true));
    void result.current.start();

    expect(previewReplan).toHaveBeenCalledTimes(1);
  });
});

/**
 * The copy is load-bearing, not decoration: the whole bug was a screen that said one static thing
 * for 271 seconds. By a minute in it has to stop implying "any second now" and start giving
 * permission to leave — which is only honest because the server persists the result and pushes.
 */
describe('waitingNote', () => {
  it('moves through phases and never repeats itself', () => {
    const notes = [0, 30_000, 100_000, 240_000].map((ms) => waitingNote(ms, false));
    expect(new Set(notes).size).toBe(4);
  });

  it('admits how long this takes once it has been a while', () => {
    expect(waitingNote(5_000, false)).not.toMatch(/minutes/);
    expect(waitingNote(100_000, false)).toMatch(/few minutes/);
  });

  it('invites them to leave, and promises the ping, once it is really long', () => {
    expect(waitingNote(240_000, false)).toMatch(/leave the app/);
  });

  it('says something different while recovering, so a resumed check is not mistaken for the first wait', () => {
    expect(waitingNote(240_000, true)).toMatch(/finished while you were away/);
  });
});
