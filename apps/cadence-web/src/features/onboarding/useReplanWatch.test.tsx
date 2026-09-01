import { act, renderHook } from '@testing-library/react';
import { useReplanWatch, REPLAN_WATCH_LINES } from './useReplanWatch.ts';

const getPendingReplan = vi.fn();

vi.mock('../../lib/api.ts', () => ({
  getPendingReplan: (...a: unknown[]) => getPendingReplan(...a),
}));

const NONE = { ok: true, proposal: null };
const RUNNING = { ok: true, proposal: null, running: { stage: 'drafting', startedAt: new Date().toISOString() } };
const FOUND = { ok: true, proposal: { activities: [], note: 'Redrawn.' } };
const FAILED = { ok: true, proposal: null, failed: { message: 'The drafting stalled.' } };

// The whole file runs on fake timers: the hook's poll loop and done-linger are timer-driven, and on
// a real clock the short-lived phases race the test's own scheduling (they slipped past waitFor
// under load). Here the clock only moves when a test advances it, so every phase holds until read.
const POLL_MS = 5;
const LINGER_MS = 300;

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  getPendingReplan.mockResolvedValue(NONE);
});
afterEach(() => {
  vi.useRealTimers();
});

function mount() {
  return renderHook(
    ({ streaming }: { streaming: boolean }) =>
      useReplanWatch({ streaming, pollEveryMs: POLL_MS, doneLingerMs: LINGER_MS }),
    { initialProps: { streaming: false } },
  );
}

/** One full coach turn: the composer locks, she replies, the composer comes back. */
async function turn(rerender: (p: { streaming: boolean }) => void) {
  await act(async () => rerender({ streaming: true }));
  await act(async () => rerender({ streaming: false }));
}

/** Advance the fake clock inside act, so the async check a fired timer kicks off settles too. */
async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

/**
 * Audit gap 5 (PLAN-CHANGES.md): after the coach kicks off a background rebuild, the turn ends and
 * nothing on screen says work is still happening. The chip's whole lifecycle: one post-turn check
 * is the gate, `running` is the only thing that arms it, and both verdicts clear it.
 */
describe('useReplanWatch', () => {
  it('checks once after a turn ends and stays silent on an ordinary turn', async () => {
    const { result, rerender } = mount();
    expect(getPendingReplan).not.toHaveBeenCalled(); // never on mount — the post-turn check is the gate

    await turn(rerender);
    expect(getPendingReplan).toHaveBeenCalledTimes(1);
    // Give a would-be poll loop several intervals to betray itself.
    await advance(POLL_MS * 4);
    expect(getPendingReplan).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe('idle');
    expect(result.current.line).toBeNull();
  });

  it('arms on running, polls to the proposal, lingers on the done line, then clears', async () => {
    getPendingReplan.mockResolvedValueOnce(RUNNING).mockResolvedValueOnce(RUNNING).mockResolvedValue(FOUND);
    const { result, rerender } = mount();

    await turn(rerender); // the post-turn check finds the run
    expect(result.current.phase).toBe('running');
    expect(result.current.line).toBe(REPLAN_WATCH_LINES.running);

    await advance(POLL_MS); // next poll: still running — the chip holds
    expect(result.current.phase).toBe('running');

    await advance(POLL_MS); // next poll: the proposal is up
    expect(result.current.phase).toBe('done');
    expect(result.current.line).toBe(REPLAN_WATCH_LINES.done);

    await advance(LINGER_MS); // the done line has had its say
    expect(result.current.phase).toBe('idle');
    expect(result.current.line).toBeNull();
  });

  it('a run that concludes with its record simply gone reads as done, not as failure', async () => {
    getPendingReplan.mockResolvedValueOnce(RUNNING).mockResolvedValue(NONE);
    const { result, rerender } = mount();

    await turn(rerender);
    await advance(POLL_MS); // the record has moved on
    expect(result.current.phase).toBe('done');
    expect(result.current.line).toBe(REPLAN_WATCH_LINES.done);
  });

  it('says a failed rebuild out loud and holds the line until the next turn starts', async () => {
    getPendingReplan.mockResolvedValueOnce(RUNNING).mockResolvedValue(FAILED);
    const { result, rerender } = mount();

    await turn(rerender);
    await advance(POLL_MS); // the verdict lands
    expect(result.current.phase).toBe('failed');
    expect(result.current.line).toBe(REPLAN_WATCH_LINES.failed);

    // It does not time out on its own — "say the word" needs the invitation still on screen…
    await advance(60_000);
    expect(result.current.phase).toBe('failed');

    // …and the next turn beginning is what retires it.
    await act(async () => rerender({ streaming: true }));
    expect(result.current.phase).toBe('idle');
    expect(result.current.line).toBeNull();
  });

  it('a failed READ mid-watch is unknown, not a verdict — it keeps watching', async () => {
    getPendingReplan
      .mockResolvedValueOnce(RUNNING)
      .mockResolvedValueOnce({ ok: false, proposal: null })
      .mockResolvedValue(FOUND);
    const { result, rerender } = mount();

    await turn(rerender);
    expect(result.current.phase).toBe('running');

    await advance(POLL_MS); // the READ fails — the chip holds instead of guessing
    expect(result.current.phase).toBe('running');

    await advance(POLL_MS);
    expect(result.current.phase).toBe('done');
  });

  /**
   * The gate's other half: a stale `failed` record on file (from a run this conversation never
   * saw start) must not grow a chip after every ordinary turn — the plan surfaces own old news.
   */
  it('never fires from a stale failed record found on an ordinary turn', async () => {
    getPendingReplan.mockResolvedValue(FAILED);
    const { result, rerender } = mount();

    await turn(rerender);
    expect(getPendingReplan).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe('idle');
    expect(result.current.line).toBeNull();
  });
});
