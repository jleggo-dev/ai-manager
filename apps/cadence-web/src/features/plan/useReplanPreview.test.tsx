import { renderHook, waitFor } from '@testing-library/react';
import { useReplanPreview, waitingNote, type ReplanStage } from './useReplanPreview.ts';

const previewReplan = vi.fn();
const getPendingReplan = vi.fn();
const confirmGoals = vi.fn();

vi.mock('../../lib/api.ts', () => ({
  previewReplan: (...a: unknown[]) => previewReplan(...a),
  getPendingReplan: (...a: unknown[]) => getPendingReplan(...a),
  confirmGoals: (...a: unknown[]) => confirmGoals(...a),
}));

const PROPOSAL = { activities: [{ title: 'Dead hangs', cadence: '3x/week' }], note: 'Loosened the elbow guard.' };
const NONE = { ok: true, proposal: null };
const FOUND = { ok: true, proposal: PROPOSAL };
const running = (stage: ReplanStage, startedAt = new Date().toISOString()) => ({
  ok: true,
  proposal: null,
  running: { stage, startedAt },
});

beforeEach(() => {
  vi.clearAllMocks();
  previewReplan.mockResolvedValue({ ok: true, running: true });
  getPendingReplan.mockResolvedValue(NONE);
  confirmGoals.mockResolvedValue(undefined);
});

/**
 * The contract these cover: POST answers 202 immediately, the run is durable server-side, and the
 * verdict — proposal, or failure in the server's words — only ever arrives via the pending poll.
 * The old shape (the answer riding on one held-open fetch) produced the owner's 2026-08-15
 * verdict: *"It says it's working on options … it never replies."* It was replying — at 271
 * seconds, into a connection iOS had already killed.
 */
describe('useReplanPreview', () => {
  const opts = { steer: () => 'stop protecting my elbow', adoptCaptured: false, pollEveryMs: 5 };

  it('surfaces a server-side pending proposal on mount, without being started', async () => {
    getPendingReplan.mockResolvedValue(FOUND);
    const { result } = renderHook(() => useReplanPreview(opts));
    await waitFor(() => expect(result.current.proposal).toEqual(PROPOSAL));
    expect(previewReplan).not.toHaveBeenCalled();
  });

  it('autoStart shows a waiting proposal instead of synthesizing over it', async () => {
    getPendingReplan.mockResolvedValue(FOUND);
    const { result } = renderHook(() => useReplanPreview({ ...opts, autoStart: true }));
    await waitFor(() => expect(result.current.proposal).toEqual(PROPOSAL));
    expect(previewReplan).not.toHaveBeenCalled();
  });

  it('autoStart synthesizes when a SUCCESSFUL check found nothing at all', async () => {
    getPendingReplan.mockResolvedValueOnce(NONE).mockResolvedValue(FOUND);
    const { result } = renderHook(() => useReplanPreview({ ...opts, autoStart: true }));
    await waitFor(() => expect(result.current.proposal).toEqual(PROPOSAL));
    expect(previewReplan).toHaveBeenCalledTimes(1);
  });

  /**
   * The hazard fix (2026-08-31): a mount-time check that FAILS (network, the paint-before-auth
   * 401) is UNKNOWN, not "nothing pending" — auto-starting on it fired a fresh synthesis over a
   * proposal that may already exist, clobbering it and paying for the replacement.
   */
  it('autoStart stays its hand when the pending check itself failed', async () => {
    getPendingReplan.mockResolvedValue({ ok: false, proposal: null });
    const { result } = renderHook(() => useReplanPreview({ ...opts, autoStart: true }));
    await waitFor(() => expect(getPendingReplan).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 10));
    expect(previewReplan).not.toHaveBeenCalled();
    expect(result.current.busy).toBe(false);
  });

  it('a failed run found on mount is shown in the server’s words, with Try again the road back', async () => {
    getPendingReplan.mockResolvedValue({ ok: true, proposal: null, failed: { message: 'The drafting stalled.' } });
    const { result } = renderHook(() => useReplanPreview(opts));
    await waitFor(() => expect(result.current.phase).toBe('failed'));
    expect(result.current.error).toBe('The drafting stalled.');
    expect(previewReplan).not.toHaveBeenCalled();
  });

  it('joins a run already in flight on mount — polls it, never POSTs a second one', async () => {
    getPendingReplan.mockResolvedValueOnce(running('drafting')).mockResolvedValue(FOUND);
    const { result } = renderHook(() => useReplanPreview(opts));
    await waitFor(() => expect(result.current.proposal).toEqual(PROPOSAL));
    expect(previewReplan).not.toHaveBeenCalled();
  });

  it('start(): POSTs with the steer verbatim, then polls its way to the proposal', async () => {
    getPendingReplan.mockResolvedValueOnce(NONE).mockResolvedValueOnce(running('reading')).mockResolvedValue(FOUND);
    const { result } = renderHook(() => useReplanPreview(opts));
    void result.current.start();
    await waitFor(() => expect(result.current.proposal).toEqual(PROPOSAL));
    expect(previewReplan).toHaveBeenCalledTimes(1);
    expect(previewReplan).toHaveBeenCalledWith('stop protecting my elbow');
    expect(result.current.busy).toBe(false);
  });

  it('joined:true is not an error — same polling, same proposal', async () => {
    previewReplan.mockResolvedValue({ ok: true, running: true, joined: true });
    getPendingReplan.mockResolvedValueOnce(NONE).mockResolvedValue(FOUND);
    const { result } = renderHook(() => useReplanPreview(opts));
    void result.current.start();
    await waitFor(() => expect(result.current.proposal).toEqual(PROPOSAL));
    expect(result.current.error).toBe('');
  });

  it('speaks the run’s REAL stage, not a guess from the clock', async () => {
    // Each stage HOLDS until the test has seen it — a one-tick stage can slip between waitFor
    // checks, which is a fact about the test clock, not the machine under test.
    let answer = running('reading');
    getPendingReplan.mockResolvedValueOnce(NONE).mockImplementation(() => Promise.resolve(answer));
    const { result } = renderHook(() => useReplanPreview(opts));
    void result.current.start();
    await waitFor(() => expect(result.current.stage).toBe('reading'));
    expect(result.current.note).toMatch(/Reading back/);
    answer = running('drafting');
    await waitFor(() => expect(result.current.stage).toBe('drafting'));
    expect(result.current.note).toMatch(/the long part/);
  });

  it('adopts captured goals before synthesizing, and only when asked to', async () => {
    getPendingReplan.mockResolvedValueOnce(NONE).mockResolvedValue(FOUND);
    const { result } = renderHook(() => useReplanPreview({ ...opts, adoptCaptured: true }));
    void result.current.start();
    await waitFor(() => expect(result.current.proposal).toEqual(PROPOSAL));
    expect(confirmGoals).toHaveBeenCalledTimes(1);

    getPendingReplan.mockResolvedValueOnce(NONE).mockResolvedValue(FOUND);
    const plain = renderHook(() => useReplanPreview(opts));
    void plain.result.current.start();
    await waitFor(() => expect(plain.result.current.proposal).toEqual(PROPOSAL));
    expect(confirmGoals).toHaveBeenCalledTimes(1);
  });

  /** The POST died — but the ask may have landed, and the run outlives this client either way. */
  it('a failed POST still polls its way to a proposal instead of declaring failure', async () => {
    previewReplan.mockResolvedValue({ ok: false });
    getPendingReplan.mockResolvedValueOnce(NONE).mockResolvedValue(FOUND);
    const { result } = renderHook(() => useReplanPreview(opts));
    void result.current.start();
    await waitFor(() => expect(result.current.proposal).toEqual(PROPOSAL));
    expect(previewReplan).toHaveBeenCalledTimes(1); // never pays for a second synthesis
  });

  it('a definite 400 fails fast, in the server’s words — no run exists to poll for', async () => {
    previewReplan.mockResolvedValue({ ok: false, invalid: true, error: 'steer too long' });
    const { result } = renderHook(() => useReplanPreview(opts));
    void result.current.start();
    await waitFor(() => expect(result.current.phase).toBe('failed'));
    expect(result.current.error).toBe('steer too long');
    expect(getPendingReplan).toHaveBeenCalledTimes(1); // the mount check only
  });

  it('a run that dies mid-flight surfaces the failure in the server’s words', async () => {
    getPendingReplan
      .mockResolvedValueOnce(NONE)
      .mockResolvedValueOnce(running('drafting'))
      .mockResolvedValue({ ok: true, proposal: null, failed: { message: 'No active goals to re-plan.' } });
    const { result } = renderHook(() => useReplanPreview(opts));
    void result.current.start();
    await waitFor(() => expect(result.current.phase).toBe('failed'));
    expect(result.current.error).toBe('No active goals to re-plan.');
  });

  it('gives up only at the polling ceiling, then says so', async () => {
    getPendingReplan.mockResolvedValue(NONE);
    const { result } = renderHook(() => useReplanPreview({ ...opts, pollCeilingMs: 25 }));
    void result.current.start();
    await waitFor(() => expect(result.current.phase).toBe('failed'));
    expect(result.current.error).toMatch(/hiccuped/);
  });

  /**
   * The real phone case: iOS suspends the webview, so the poll's sleep never wakes. Coming back
   * fires an immediate out-of-band check — just another poll tick, but NOW.
   */
  it('collects a proposal on resume while the poll timer sleeps', async () => {
    getPendingReplan.mockResolvedValueOnce(NONE).mockResolvedValueOnce(NONE).mockResolvedValue(FOUND);
    const { result } = renderHook(() => useReplanPreview({ ...opts, pollEveryMs: 60_000 }));
    void result.current.start();
    await waitFor(() => expect(result.current.busy).toBe(true));
    await waitFor(() => expect(getPendingReplan).toHaveBeenCalledTimes(2)); // mount + first tick

    document.dispatchEvent(new Event('visibilitychange'));
    await waitFor(() => expect(result.current.proposal).toEqual(PROPOSAL));
  });

  it('a resume that finds nothing yet leaves the wait alone', async () => {
    getPendingReplan.mockResolvedValue(NONE);
    const { result } = renderHook(() => useReplanPreview({ ...opts, pollEveryMs: 60_000 }));
    void result.current.start();
    await waitFor(() => expect(result.current.busy).toBe(true));

    document.dispatchEvent(new Event('visibilitychange'));
    await new Promise((r) => setTimeout(r, 10));
    expect(result.current.busy).toBe(true);
    expect(result.current.error).toBe('');
  });

  it('will not start a second synthesis on top of one already running', async () => {
    getPendingReplan.mockResolvedValue(NONE);
    const { result } = renderHook(() => useReplanPreview({ ...opts, pollEveryMs: 60_000 }));
    void result.current.start();
    await waitFor(() => expect(result.current.busy).toBe(true));
    void result.current.start();
    expect(previewReplan).toHaveBeenCalledTimes(1);
  });
});

/**
 * The copy is load-bearing, not decoration: it is keyed to the stage the server REPORTS, which is
 * what makes it true — the old bands guessed from the elapsed clock.
 */
describe('waitingNote', () => {
  it('has one line per stage, each its own', () => {
    const notes = (['reading', 'drafting', 'saving'] as const).map((s) => waitingNote(s));
    expect(new Set(notes).size).toBe(3);
    expect(waitingNote('reading')).toMatch(/Reading back/);
    expect(waitingNote('drafting')).toMatch(/the long part/);
    expect(waitingNote('saving')).toMatch(/Writing it down/);
  });

  it('covers the beat before the first stage report with the reading line — a run starts by reading', () => {
    expect(waitingNote(null)).toBe(waitingNote('reading'));
  });
});
