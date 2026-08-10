import { act, renderHook, waitFor } from '@testing-library/react';
import { useCoachChat } from './useCoachChat.ts';

const getCurrentCoach = vi.fn();
const getReview = vi.fn();
const openCoachSession = vi.fn();
const sendCoachMessage = vi.fn();
const prepareCoachFoodAction = vi.fn();

vi.mock('../../lib/api.ts', () => ({
  getCurrentCoach: (...args: unknown[]) => getCurrentCoach(...args),
  getReview: (...args: unknown[]) => getReview(...args),
  openCoachSession: (...args: unknown[]) => openCoachSession(...args),
  sendCoachMessage: (...args: unknown[]) => sendCoachMessage(...args),
  prepareCoachFoodAction: (...args: unknown[]) => prepareCoachFoodAction(...args),
}));

describe('useCoachChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentCoach.mockResolvedValue({ sessionId: null, messages: [], stale: false });
    getReview.mockResolvedValue({ goals: [] });
    openCoachSession.mockResolvedValue({ sessionId: 'sess-new' });
    sendCoachMessage.mockResolvedValue({ completed: true, responseId: null });
    prepareCoachFoodAction.mockResolvedValue({ status: 'ok', action: null });
  });

  it('restores a non-stale thread and skips stale transcripts', async () => {
    getCurrentCoach.mockResolvedValueOnce({
      sessionId: 'sess-1',
      stale: false,
      messages: [
        { role: 'user', content: 'hi' },
        { role: 'coach', content: 'hello' },
      ],
    });
    const { result } = renderHook(() => useCoachChat());
    await waitFor(() => expect(result.current.restored).toBe(true));
    expect(result.current.turns).toEqual([
      { role: 'user', text: 'hi' },
      { role: 'coach', text: 'hello' },
    ]);
    expect(result.current.sessionId.current).toBe('sess-1');

    getCurrentCoach.mockResolvedValueOnce({
      sessionId: 'old',
      stale: true,
      messages: [{ role: 'coach', content: 'stale chatter' }],
    });
    const stale = renderHook(() => useCoachChat());
    await waitFor(() => expect(stale.result.current.restored).toBe(true));
    expect(stale.result.current.turns).toEqual([]);
    expect(stale.result.current.sessionId.current).toBeNull();
  });

  it('applyStreamDelta appends without mutating the prior turn object', async () => {
    const { result } = renderHook(() => useCoachChat());
    await waitFor(() => expect(result.current.restored).toBe(true));

    act(() => {
      result.current.fillLastCoach('');
    });
    const before = result.current.turns[result.current.turns.length - 1];
    act(() => {
      result.current.applyStreamDelta('Hello');
      result.current.applyStreamDelta(' world');
    });
    const after = result.current.turns[result.current.turns.length - 1];
    expect(after?.text).toBe('Hello world');
    expect(after).not.toBe(before);
  });

  it('recoverFromServer polls until a coach reply appears', async () => {
    getCurrentCoach
      .mockResolvedValueOnce({ sessionId: null, messages: [], stale: false }) // mount restore
      .mockResolvedValueOnce({ sessionId: 's', messages: [{ role: 'user', content: 'x' }], stale: false })
      .mockResolvedValueOnce({
        sessionId: 's',
        messages: [
          { role: 'user', content: 'x' },
          { role: 'coach', content: 'recovered reply' },
        ],
        stale: false,
      });

    const delay = vi.fn(async () => undefined);
    const { result } = renderHook(() => useCoachChat({ delay }));
    await waitFor(() => expect(result.current.restored).toBe(true));

    let ok = false;
    await act(async () => {
      ok = await result.current.recoverFromServer();
    });
    expect(ok).toBe(true);
    expect(result.current.turns.at(-1)).toEqual({ role: 'coach', text: 'recovered reply' });
    expect(delay).toHaveBeenCalled();
  });

  it('on dropped stream, recovers from server instead of showing the warning', async () => {
    getCurrentCoach.mockResolvedValueOnce({ sessionId: null, messages: [], stale: false }).mockResolvedValueOnce({
      sessionId: 'sess-new',
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'coach', content: 'I heard you' },
      ],
      stale: false,
    });
    sendCoachMessage.mockResolvedValueOnce({ completed: false, responseId: null });

    const delay = vi.fn(async () => undefined);
    const { result } = renderHook(() => useCoachChat({ delay }));
    await waitFor(() => expect(result.current.restored).toBe(true));

    act(() => result.current.setInput('Hello'));
    await act(async () => {
      await result.current.send();
    });

    expect(result.current.turns.at(-1)?.text).toBe('I heard you');
    expect(result.current.turns.some((t) => t.text.includes('Connection dropped'))).toBe(false);
  });
});

/**
 * Sharing months of Apple Health history and getting "just keep talking" back is the app taking
 * something and saying nothing with it. `nudge` is how the card asks her to read it out loud —
 * and the note itself must never appear as a message the user wrote.
 */
describe('nudge', () => {
  // The suite's other beforeEach lives inside its own describe, so this block needs its own —
  // without it the assertions read mock calls left over from the tests above.
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentCoach.mockResolvedValue({ sessionId: null, messages: [], stale: false });
    getReview.mockResolvedValue({ goals: [] });
    openCoachSession.mockResolvedValue({ sessionId: 'sess-new' });
    sendCoachMessage.mockResolvedValue({ completed: true, responseId: null });
    prepareCoachFoodAction.mockResolvedValue({ status: 'ok', action: null });
  });

  it("streams a coach turn without putting words in the user's bubble", async () => {
    const { result } = renderHook(() => useCoachChat());
    await waitFor(() => expect(result.current.restored).toBe(true));

    sendCoachMessage.mockImplementation(async (_id: string, _t: string, onDelta: (d: string) => void) => {
      onDelta('Three runs a week — good base.');
      return { completed: true, responseId: null };
    });

    await act(async () => {
      await result.current.nudge('They shared Apple Health.');
    });

    expect(result.current.turns.filter((t) => t.role === 'user')).toHaveLength(0);
    expect(result.current.turns.at(-1)).toEqual({ role: 'coach', text: 'Three runs a week — good base.' });
    expect(sendCoachMessage.mock.calls[0]![1]).toContain('<note>');
  });

  it('never runs the food classifier over an app note', async () => {
    const { result } = renderHook(() => useCoachChat());
    await waitFor(() => expect(result.current.restored).toBe(true));

    await act(async () => {
      await result.current.nudge('They shared Apple Health.');
    });

    expect(prepareCoachFoodAction).not.toHaveBeenCalled();
  });
});
