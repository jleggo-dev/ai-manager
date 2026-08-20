import { renderHook, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { useCoachTranscript } from './useCoachTranscript.ts';
import { readCachedTranscript, writeCachedTranscript } from './coach-transcript-cache.ts';

const getCurrentCoach = vi.fn();
vi.mock('../../lib/api.ts', () => ({
  getCurrentCoach: (...args: unknown[]) => getCurrentCoach(...args),
}));

const mount = (streaming = false) => {
  const sessionId = createRef<string | null>() as { current: string | null };
  sessionId.current = null;
  return {
    sessionId,
    ...renderHook(() => useCoachTranscript({ sessionId, streaming, onSettled: () => {} })),
  };
};

/**
 * The transcript: painted from the device first, then reconciled with the server. The tests that
 * matter are the ones about WHOSE answer wins, because getting that wrong either shows someone a
 * conversation that is over or blanks one that isn't.
 */
describe('useCoachTranscript', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentCoach.mockResolvedValue({ ok: true, sessionId: null, messages: [], stale: false });
  });

  it('paints the cached conversation on the very first render, before the server answers', () => {
    writeCachedTranscript('sess-1', [{ role: 'user', text: 'from last time' }]);
    let resolve: (v: unknown) => void = () => {};
    getCurrentCoach.mockReturnValueOnce(new Promise((r) => (resolve = r)));

    const { result } = mount();
    // No awaiting: this is the first synchronous render, with the request still in the air.
    expect(result.current.turns).toEqual([{ role: 'user', text: 'from last time' }]);
    expect(result.current.painted).toBe(true);
    expect(result.current.restored).toBe(false);
    resolve({ ok: true, sessionId: null, messages: [] });
  });

  it('never adopts the cached session — only the server decides which thread is live', async () => {
    writeCachedTranscript('sess-cached', [{ role: 'user', text: 'from last time' }]);
    const { result, sessionId } = mount();
    await waitFor(() => expect(result.current.restored).toBe(true));
    expect(sessionId.current).toBeNull();
  });

  it('replaces what the cache painted with the server’s version', async () => {
    writeCachedTranscript('sess-1', [{ role: 'user', text: 'stale paint' }]);
    getCurrentCoach.mockResolvedValueOnce({
      ok: true,
      sessionId: 'sess-1',
      stale: false,
      messages: [
        { role: 'user', content: 'stale paint' },
        { role: 'coach', content: 'and her reply' },
      ],
      startedAt: '2026-08-19T10:00:00Z',
      hasEarlier: true,
    });
    const { result, sessionId } = mount();
    await waitFor(() => expect(result.current.restored).toBe(true));
    expect(result.current.turns).toHaveLength(2);
    expect(sessionId.current).toBe('sess-1');
    expect(result.current.cursor).toEqual({ startedAt: '2026-08-19T10:00:00Z', hasEarlier: true });
  });

  /**
   * A retirement moves the SAME conversation from the live half to the read-only half. Leaving the
   * cache's copy in `turns` would render every one of those turns twice.
   */
  it('clears the painted turns when the thread it painted has been retired', async () => {
    writeCachedTranscript('old', [{ role: 'coach', text: 'earlier chatter' }]);
    getCurrentCoach.mockResolvedValueOnce({
      ok: true,
      sessionId: 'old',
      stale: true,
      messages: [{ role: 'coach', content: 'earlier chatter' }],
    });
    const { result, sessionId } = mount();
    await waitFor(() => expect(result.current.restored).toBe(true));
    expect(result.current.turns).toEqual([]);
    expect(result.current.earlierTurns).toEqual([{ role: 'coach', text: 'earlier chatter' }]);
    expect(sessionId.current).toBeNull();
  });

  /**
   * The disappearance this whole feature exists to prevent, in miniature: a dropped request and an
   * empty account return the identical shape, so only an answer the server VOUCHED for may clear
   * the screen.
   */
  it('keeps the painted conversation when the read fails', async () => {
    writeCachedTranscript('sess-1', [{ role: 'user', text: 'still mine' }]);
    getCurrentCoach.mockRejectedValueOnce(new Error('offline'));
    const { result } = mount();
    await waitFor(() => expect(result.current.restored).toBe(true));
    expect(result.current.turns).toEqual([{ role: 'user', text: 'still mine' }]);
  });

  it('keeps it too when the API soft-fails without vouching for the answer', async () => {
    writeCachedTranscript('sess-1', [{ role: 'user', text: 'still mine' }]);
    getCurrentCoach.mockResolvedValueOnce({ sessionId: null, messages: [], stale: false });
    const { result } = mount();
    await waitFor(() => expect(result.current.restored).toBe(true));
    expect(result.current.turns).toEqual([{ role: 'user', text: 'still mine' }]);
  });

  it('clears the device when the server genuinely says there is nothing on file', async () => {
    writeCachedTranscript('sess-1', [{ role: 'user', text: 'wiped' }]);
    getCurrentCoach.mockResolvedValueOnce({ ok: true, sessionId: null, messages: [], stale: false });
    const { result } = mount();
    await waitFor(() => expect(result.current.restored).toBe(true));
    expect(result.current.turns).toEqual([]);
    expect(readCachedTranscript()).toBeNull();
  });

  it('remembers the settled conversation on the device', async () => {
    getCurrentCoach.mockResolvedValueOnce({
      ok: true,
      sessionId: 'sess-1',
      stale: false,
      messages: [{ role: 'coach', content: 'remember this' }],
    });
    const { result } = mount();
    await waitFor(() => expect(result.current.restored).toBe(true));
    await waitFor(() =>
      expect(readCachedTranscript()).toEqual({
        sessionId: 'sess-1',
        turns: [{ role: 'coach', text: 'remember this' }],
      }),
    );
  });
});
