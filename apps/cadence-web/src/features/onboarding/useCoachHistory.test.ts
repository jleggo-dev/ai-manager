import { act, renderHook, waitFor } from '@testing-library/react';
import { useCoachHistory } from './useCoachHistory.ts';

const getEarlierCoachConversations = vi.fn();
vi.mock('../../lib/api.ts', () => ({
  getEarlierCoachConversations: (...args: unknown[]) => getEarlierCoachConversations(...args),
}));

const conv = (id: string, startedAt: string) => ({
  sessionId: id,
  startedAt,
  lastActiveAt: startedAt,
  turns: [{ role: 'user' as const, content: `said in ${id}` }],
  truncated: false,
});

/**
 * Reading back through previous conversations. The interesting behaviour is all about the CURSOR:
 * where the next request starts, and what happens when a request comes back with nothing.
 */
describe('useCoachHistory', () => {
  beforeEach(() => vi.clearAllMocks());

  it('offers nothing to read when the server says there is nothing behind this conversation', () => {
    const { result } = renderHook(() => useCoachHistory({ startedAt: '2026-08-19T10:00:00Z', hasEarlier: false }));
    expect(result.current.canLoad).toBe(false);
  });

  it('offers nothing before the chat has restored — there is no cursor to read back from yet', () => {
    const { result } = renderHook(() => useCoachHistory({ startedAt: null, hasEarlier: true }));
    expect(result.current.canLoad).toBe(false);
  });

  it('loads one conversation per ask, starting from the conversation on screen', async () => {
    getEarlierCoachConversations.mockResolvedValueOnce({
      conversations: [conv('c2', '2026-08-12T09:00:00Z')],
      hasMore: true,
      nextBefore: '2026-08-12T09:00:00Z',
    });
    const { result } = renderHook(() => useCoachHistory({ startedAt: '2026-08-19T10:00:00Z', hasEarlier: true }));

    await act(async () => void (await result.current.loadEarlier()));
    expect(getEarlierCoachConversations).toHaveBeenCalledWith('2026-08-19T10:00:00Z', 1);
    expect(result.current.earlier.map((c) => c.sessionId)).toEqual(['c2']);

    // The next ask starts where the last one stopped, and older conversations land ABOVE the
    // ones already on screen so the transcript reads down through time.
    getEarlierCoachConversations.mockResolvedValueOnce({
      conversations: [conv('c3', '2026-08-01T09:00:00Z')],
      hasMore: false,
      nextBefore: '2026-08-01T09:00:00Z',
    });
    await act(async () => void (await result.current.loadEarlier()));
    expect(getEarlierCoachConversations).toHaveBeenLastCalledWith('2026-08-12T09:00:00Z', 1);
    expect(result.current.earlier.map((c) => c.sessionId)).toEqual(['c3', 'c2']);
    await waitFor(() => expect(result.current.canLoad).toBe(false));
  });

  /**
   * The stall this exists to prevent: a session opened and never spoken into leaves a row with no
   * real turns, which the server filters out. If the cursor only tracked RESULTS it would never
   * move past that row, and every further tap would re-scan the same stretch of archive forever.
   */
  it('advances past conversations that held nothing, instead of asking the same question again', async () => {
    getEarlierCoachConversations.mockResolvedValueOnce({
      conversations: [],
      hasMore: true,
      nextBefore: '2026-08-10T09:00:00Z',
    });
    const { result } = renderHook(() => useCoachHistory({ startedAt: '2026-08-19T10:00:00Z', hasEarlier: true }));
    await act(async () => void (await result.current.loadEarlier()));
    expect(result.current.earlier).toEqual([]);
    expect(result.current.canLoad).toBe(true);

    getEarlierCoachConversations.mockResolvedValueOnce({ conversations: [], hasMore: false, nextBefore: null });
    await act(async () => void (await result.current.loadEarlier()));
    expect(getEarlierCoachConversations).toHaveBeenLastCalledWith('2026-08-10T09:00:00Z', 1);
  });

  it('keeps the offer standing when a read fails, rather than saying the history ended here', async () => {
    getEarlierCoachConversations.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useCoachHistory({ startedAt: '2026-08-19T10:00:00Z', hasEarlier: true }));
    await act(async () => void (await result.current.loadEarlier()));
    expect(result.current.earlier).toEqual([]);
    expect(result.current.canLoad).toBe(true);
    expect(result.current.loading).toBe(false);
  });

  it('does not paste the same conversation in twice when the control is tapped twice', async () => {
    let release: (v: unknown) => void = () => {};
    getEarlierCoachConversations.mockReturnValueOnce(new Promise((r) => (release = r)));
    const { result } = renderHook(() => useCoachHistory({ startedAt: '2026-08-19T10:00:00Z', hasEarlier: true }));

    await act(async () => {
      const first = result.current.loadEarlier();
      // The second tap lands before React has re-rendered with `loading` — the case a state flag
      // cannot catch, and the one that would duplicate a conversation in the transcript.
      const second = result.current.loadEarlier();
      release({ conversations: [conv('c2', '2026-08-12T09:00:00Z')], hasMore: false, nextBefore: null });
      await Promise.all([first, second]);
    });
    expect(getEarlierCoachConversations).toHaveBeenCalledTimes(1);
    expect(result.current.earlier.map((c) => c.sessionId)).toEqual(['c2']);
  });
});
