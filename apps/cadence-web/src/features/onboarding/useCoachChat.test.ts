import { act, renderHook, waitFor } from '@testing-library/react';
import { useCoachChat } from './useCoachChat.ts';

const getCurrentCoach = vi.fn();
const getReview = vi.fn();
const openCoachSession = vi.fn();
const sendCoachMessage = vi.fn();
const prepareCoachFoodAction = vi.fn();
const stopCoachTurn = vi.fn();

vi.mock('../../lib/api.ts', () => ({
  getCurrentCoach: (...args: unknown[]) => getCurrentCoach(...args),
  getReview: (...args: unknown[]) => getReview(...args),
  openCoachSession: (...args: unknown[]) => openCoachSession(...args),
  sendCoachMessage: (...args: unknown[]) => sendCoachMessage(...args),
  prepareCoachFoodAction: (...args: unknown[]) => prepareCoachFoodAction(...args),
  stopCoachTurn: (...args: unknown[]) => stopCoachTurn(...args),
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

  /**
   * The phone case the test above cannot reach. iOS suspends the webview mid-turn and the fetch
   * NEVER settles — it neither resolves nor rejects — so every recovery path that hangs off the
   * send promise is unreachable and the composer stays locked over a reply already on file.
   * Coming back to the app is the only signal left, and it has to be enough.
   */
  it('heals a turn abandoned mid-stream when the app comes back', async () => {
    getCurrentCoach.mockResolvedValueOnce({ sessionId: null, messages: [], stale: false }).mockResolvedValue({
      sessionId: 'sess-new',
      messages: [
        { role: 'user', content: 'Hello' },
        { role: 'coach', content: 'Here is what I think' },
      ],
      stale: false,
      generating: false,
    });
    // The suspended fetch: no resolve, no reject, ever.
    sendCoachMessage.mockImplementation(() => new Promise(() => {}));

    const delay = vi.fn(async () => undefined);
    const { result } = renderHook(() => useCoachChat({ delay }));
    await waitFor(() => expect(result.current.restored).toBe(true));

    act(() => result.current.setInput('Hello'));
    act(() => void result.current.send());
    await waitFor(() => expect(result.current.streaming).toBe(true));

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => expect(result.current.turns.at(-1)?.text).toBe('Here is what I think'));
    // The composer comes back — otherwise they are locked out of a conversation that is fine.
    await waitFor(() => expect(result.current.streaming).toBe(false));
    expect(result.current.turns.some((t) => t.text.includes('hiccuped') || t.text.includes('dropped'))).toBe(false);
  });

  it('a resume with nothing new on the server leaves the turn streaming', async () => {
    // Server has the question but no answer yet, and is not claiming to be writing one — the
    // healer must give up quietly and leave the turn alone rather than declaring anything.
    getCurrentCoach.mockResolvedValue({
      sessionId: 'sess-new',
      messages: [{ role: 'user', content: 'Hello' }],
      stale: false,
      generating: false,
    });
    sendCoachMessage.mockImplementation(() => new Promise(() => {}));

    const delay = vi.fn(async () => undefined);
    const { result } = renderHook(() => useCoachChat({ delay }));
    await waitFor(() => expect(result.current.restored).toBe(true));
    act(() => result.current.setInput('Hello'));
    act(() => void result.current.send());
    await waitFor(() => expect(result.current.streaming).toBe(true));

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(result.current.streaming).toBe(true);
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

/** "I mistyped something" — stop must hand the composer back without looking like a failure. */
describe('stop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentCoach.mockResolvedValue({ sessionId: null, messages: [], stale: false });
    getReview.mockResolvedValue({ goals: [] });
    openCoachSession.mockResolvedValue({ sessionId: 'sess-new' });
    prepareCoachFoodAction.mockResolvedValue({ status: 'ok', action: null });
  });

  it('ends the turn without the dropped-connection warning', async () => {
    // A stream that never finishes on its own; only an abort ends it.
    sendCoachMessage.mockImplementation(
      (_id: string, _t: string, onDelta: (d: string) => void, signal?: AbortSignal) =>
        new Promise((_resolve, reject) => {
          onDelta('Right — so you have been ');
          signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const { result } = renderHook(() => useCoachChat());
    await waitFor(() => expect(result.current.restored).toBe(true));

    act(() => result.current.setInput('teling you about my kne'));
    let sending: Promise<void>;
    act(() => {
      sending = result.current.send();
    });
    await waitFor(() => expect(result.current.streaming).toBe(true));

    await act(async () => {
      result.current.stop();
      await sending!;
    });

    expect(result.current.streaming).toBe(false);
    const texts = result.current.turns.map((t) => t.text).join(' ');
    expect(texts).toContain('Right — so you have been'); // what she said is kept
    expect(texts).not.toMatch(/Connection dropped|hiccuped/); // stopping is not a failure
    // Aborting only ends OUR read; without this call the turn ran on upstream, billed in full and
    // reappearing whole on the next restore — the opposite of what the button says.
    expect(stopCoachTurn).toHaveBeenCalledWith('sess-new');
  });

  it('is a no-op when nothing is streaming', async () => {
    const { result } = renderHook(() => useCoachChat());
    await waitFor(() => expect(result.current.restored).toBe(true));
    expect(() => result.current.stop()).not.toThrow();
    expect(stopCoachTurn).not.toHaveBeenCalled();
  });
});

describe('the food surface during onboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentCoach.mockResolvedValue({ sessionId: null, messages: [], stale: false });
    getReview.mockResolvedValue({ goals: [] });
    openCoachSession.mockResolvedValue({ sessionId: 'sess-new' });
    prepareCoachFoodAction.mockResolvedValue({ status: 'ok', action: null });
    sendCoachMessage.mockImplementation(async (_id: string, _t: string, onDelta: (d: string) => void) => {
      onDelta('Understood.');
      return { completed: true, responseId: null };
    });
  });

  it('never prepares a food action while onboarding', async () => {
    const { result } = renderHook(() => useCoachChat({ intent: 'onboarding' }));
    await waitFor(() => expect(result.current.restored).toBe(true));

    act(() => result.current.setInput('I do at least one beast a year, but I had to skip it this year'));
    await act(async () => {
      await result.current.send();
    });

    expect(prepareCoachFoodAction).not.toHaveBeenCalled();
  });

  it('still prepares one in the ongoing conversation, where a plan exists', async () => {
    const { result } = renderHook(() => useCoachChat({ intent: 'ongoing' }));
    await waitFor(() => expect(result.current.restored).toBe(true));

    act(() => result.current.setInput('I had eggs and toast'));
    await act(async () => {
      await result.current.send();
    });

    expect(prepareCoachFoodAction).toHaveBeenCalled();
  });
});
