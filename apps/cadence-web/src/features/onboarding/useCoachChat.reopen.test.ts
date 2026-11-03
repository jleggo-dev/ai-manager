/**
 * The app reopened on a reply still being written (owner, 2026-11-03: switching apps or locking
 * the screen must not kill the answer — "when I come back, the answer I was waiting on is there,
 * or still arriving").
 *
 * The healer covers a resume (useResumeHealer): the hook is still mounted and knows a turn is in
 * the air. This is the case past it — iOS reclaimed the webview while the phone sat locked, the app
 * relaunched, and the only memory of the turn is the server's: GET /coach/current says
 * `generating` with the person's message as the last word on file. The transcript hook adopts the
 * thread with her empty bubble; the chat hook waits the way it waits for a dropped stream.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { useCoachChat } from './useCoachChat.ts';
import { useCoachTranscript } from './useCoachTranscript.ts';
import { REPLY_LOST } from './coach-recovery.ts';

const getCurrentCoach = vi.fn();
const getReview = vi.fn();
const openCoachSession = vi.fn();
const sendCoachMessage = vi.fn();
const prepareCoachFoodAction = vi.fn();
const stopCoachTurn = vi.fn();

vi.mock('../../lib/api.ts', () => ({
  getCurrentCoach: (...a: unknown[]) => getCurrentCoach(...a),
  getReview: (...a: unknown[]) => getReview(...a),
  openCoachSession: (...a: unknown[]) => openCoachSession(...a),
  sendCoachMessage: (...a: unknown[]) => sendCoachMessage(...a),
  prepareCoachFoodAction: (...a: unknown[]) => prepareCoachFoodAction(...a),
  stopCoachTurn: (...a: unknown[]) => stopCoachTurn(...a),
}));

const asked = { role: 'user', content: 'what should I eat tonight?' };
const answered = { role: 'coach', content: 'Something with eggs — you have them in.' };
const current = (over: Record<string, unknown>) => ({ ok: true, sessionId: 's', stale: false, ...over });

beforeEach(() => {
  vi.clearAllMocks();
  getReview.mockResolvedValue({ goals: [] });
  getCurrentCoach.mockResolvedValue(current({ messages: [], sessionId: null }));
  openCoachSession.mockResolvedValue({ sessionId: 's' });
  prepareCoachFoodAction.mockResolvedValue({ status: 'ok', action: null });
});

describe('useCoachTranscript — a reply still being written on restore', () => {
  const mount = (onGenerating: (sid: string) => void) => {
    const sessionId = createRef<string | null>() as { current: string | null };
    sessionId.current = null;
    return {
      sessionId,
      ...renderHook(() => useCoachTranscript({ sessionId, streaming: false, onSettled: () => {}, onGenerating })),
    };
  };

  it('adopts the thread with her empty bubble and says a reply is on its way', async () => {
    getCurrentCoach.mockResolvedValueOnce(current({ generating: true, messages: [asked] }));
    const onGenerating = vi.fn();
    const { result, sessionId } = mount(onGenerating);
    await waitFor(() => expect(result.current.restored).toBe(true));
    expect(sessionId.current).toBe('s');
    expect(result.current.turns).toEqual([
      { role: 'user', text: asked.content },
      { role: 'coach', text: '' },
    ]);
    expect(onGenerating).toHaveBeenCalledWith('s');
  });

  it('a reply already on file with the mark not yet cleared is simply adopted — no bubble, no waiting', async () => {
    getCurrentCoach.mockResolvedValueOnce(current({ generating: true, messages: [asked, answered] }));
    const onGenerating = vi.fn();
    const { result } = mount(onGenerating);
    await waitFor(() => expect(result.current.restored).toBe(true));
    expect(result.current.turns).toEqual([
      { role: 'user', text: asked.content },
      { role: 'coach', text: answered.content },
    ]);
    expect(onGenerating).not.toHaveBeenCalled();
  });

  it('a stale thread that was generating is kept aside like any stale thread, never waited on', async () => {
    getCurrentCoach.mockResolvedValueOnce(current({ stale: true, generating: true, messages: [asked] }));
    const onGenerating = vi.fn();
    const { result } = mount(onGenerating);
    await waitFor(() => expect(result.current.restored).toBe(true));
    expect(result.current.turns).toEqual([]);
    expect(result.current.earlierTurns).toEqual([{ role: 'user', text: asked.content }]);
    expect(onGenerating).not.toHaveBeenCalled();
  });
});

describe('useCoachChat — reopened on a reply still being written', () => {
  /**
   * The healer's waits between polls, held by the test: with a wait that returns at once the whole
   * recovery runs inside one tick and `streaming` is never seen true. Each `release()` lets one
   * poll go; `drain` releases them until the turn has settled.
   */
  let gates: (() => void)[] = [];
  const held = () => new Promise<void>((r) => gates.push(r));
  const drain = (result: { current: { streaming: boolean } }) =>
    waitFor(() => {
      act(() => gates.shift()?.());
      expect(result.current.streaming).toBe(false);
    });
  beforeEach(() => {
    gates = [];
  });

  it('shows her bubble, waits while the server is still writing, then adopts the reply', async () => {
    getCurrentCoach
      .mockResolvedValueOnce(current({ generating: true, messages: [asked] })) // the restore
      .mockResolvedValueOnce(current({ generating: true, messages: [asked] })) // still writing
      .mockResolvedValueOnce(current({ generating: false, messages: [asked, answered] })); // landed
    const { result } = renderHook(() => useCoachChat({ intent: 'ongoing', delay: held }));
    await waitFor(() => expect(result.current.streaming).toBe(true));
    expect(result.current.turns).toEqual([
      { role: 'user', text: asked.content },
      { role: 'coach', text: '' },
    ]);
    await drain(result);
    expect(result.current.turns).toEqual([
      { role: 'user', text: asked.content },
      { role: 'coach', text: answered.content },
    ]);
    expect(result.current.sessionId.current).toBe('s');
    // Nothing was sent: the reply was waited for, not asked for again.
    expect(sendCoachMessage).not.toHaveBeenCalled();
    expect(openCoachSession).not.toHaveBeenCalled();
  });

  it('a reply the server said it was writing and never delivered is told as lost — plain words, not a dropped connection', async () => {
    getCurrentCoach.mockResolvedValueOnce(current({ generating: true, messages: [asked] }));
    // Every poll after: not writing, and no reply — the turn died with its instance.
    getCurrentCoach.mockResolvedValue(current({ generating: false, messages: [asked] }));
    const { result } = renderHook(() => useCoachChat({ intent: 'ongoing', delay: held }));
    await waitFor(() => expect(result.current.streaming).toBe(true));
    await drain(result);
    expect(result.current.turns[result.current.turns.length - 1]).toEqual({ role: 'coach', text: REPLY_LOST });
    // The composer is theirs again: a new message opens as usual.
    sendCoachMessage.mockResolvedValue({ completed: true, responseId: null });
    act(() => result.current.setInput('ok, what about lunch?'));
    await act(async () => {
      await result.current.send();
    });
    expect(sendCoachMessage).toHaveBeenCalledTimes(1);
  });
});
