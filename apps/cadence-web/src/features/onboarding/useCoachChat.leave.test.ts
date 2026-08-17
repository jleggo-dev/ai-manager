/**
 * Backgrounding the app mid-turn, and whether "notify me when she's done" actually gets sent.
 *
 * The server cannot see somebody leave — a suspended webview's socket stays open long enough for
 * the reply to land on a connection nobody is reading — so the client states it out loud while iOS
 * still lets it. Two things had to be true for that to work and only one of them was.
 *
 * The gap this file pins: the arming request carries the session id in its URL, and on the FIRST
 * turn of a fresh thread there is a window — `healer.begin()` has run, `openCoachSession()` has
 * not come back — where `sessionId.current` is still null. Leaving in that window called
 * `notifyOnCoachReply(null)`, which returns without sending anything at all. No request, no row in
 * `cadence.notifications`, no notification, and nothing anywhere saying why.
 *
 * The other half is the route's own refusal — see coach-notify-arm.test.ts in cadence-api.
 *
 * Note the leave is driven with `document.hidden`, not a bare `visibilitychange`: useAppLeave only
 * fires on hidden, and jsdom reports `hidden === false`, so a bare dispatch exercises useAppRESUME
 * instead. That is why the existing useCoachChat tests never reached this path.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { useCoachChat } from './useCoachChat.ts';

const getCurrentCoach = vi.fn();
const getReview = vi.fn();
const openCoachSession = vi.fn();
const sendCoachMessage = vi.fn();
const prepareCoachFoodAction = vi.fn();
const stopCoachTurn = vi.fn();
const notifyOnCoachReply = vi.fn();

vi.mock('../../lib/api.ts', () => ({
  getCurrentCoach: (...a: unknown[]) => getCurrentCoach(...a),
  getReview: (...a: unknown[]) => getReview(...a),
  openCoachSession: (...a: unknown[]) => openCoachSession(...a),
  sendCoachMessage: (...a: unknown[]) => sendCoachMessage(...a),
  prepareCoachFoodAction: (...a: unknown[]) => prepareCoachFoodAction(...a),
  stopCoachTurn: (...a: unknown[]) => stopCoachTurn(...a),
  notifyOnCoachReply: (...a: unknown[]) => notifyOnCoachReply(...a),
}));

/**
 * The arming requests that actually went out, in order.
 *
 * `notifyOnCoachReply(null)` returns at its first line without sending anything, so counting raw
 * calls would score the bug as a success — the old code called it, it just called it with nothing.
 * Backgrounding fires both of useAppLeave's doors (visibilitychange and Capacitor's own
 * appStateChange, which the web shim derives from the same event), so duplicates are expected and
 * harmless: arming is idempotent server-side.
 */
const armsSent = () => notifyOnCoachReply.mock.calls.map(([id]) => id).filter(Boolean);

/** iOS suspends the webview: `document.hidden` flips, THEN the event fires. */
function background() {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
  document.dispatchEvent(new Event('visibilitychange'));
}
afterEach(() => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
});

/** A promise the test settles by hand, so a turn can be caught mid-flight. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useCoachChat — leaving mid-turn', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentCoach.mockResolvedValue({ sessionId: null, messages: [], stale: false });
    getReview.mockResolvedValue({ goals: [] });
    openCoachSession.mockResolvedValue({ sessionId: 'sess-new' });
    sendCoachMessage.mockResolvedValue({ completed: true, responseId: null });
    prepareCoachFoodAction.mockResolvedValue({ status: 'ok', action: null });
    notifyOnCoachReply.mockResolvedValue(true);
  });

  async function mounted(restoredSession: string | null) {
    if (restoredSession) {
      getCurrentCoach.mockResolvedValueOnce({ sessionId: restoredSession, messages: [], stale: false });
    }
    const hook = renderHook(() => useCoachChat({ intent: 'ongoing' }));
    await waitFor(() => expect(hook.result.current.restored).toBe(true));
    return hook;
  }

  it('arms the ping when the app goes away with a reply still coming', async () => {
    const stream = deferred<{ completed: boolean; responseId: null }>();
    sendCoachMessage.mockReturnValueOnce(stream.promise);
    const { result } = await mounted('sess-1');

    act(() => result.current.setInput('how did last week go?'));
    let sending!: Promise<void>;
    act(() => {
      sending = result.current.send();
    });
    await waitFor(() => expect(sendCoachMessage).toHaveBeenCalled());

    act(background);
    expect(armsSent()).toContain('sess-1');

    await act(async () => {
      stream.resolve({ completed: true, responseId: null });
      await sending;
    });
  });

  /**
   * THE regression. A fresh thread has no id until `openCoachSession` answers, and someone who
   * sends a message and immediately switches apps leaves inside that window.
   */
  it('still arms when they leave before the thread has an id yet', async () => {
    const opening = deferred<{ sessionId: string }>();
    openCoachSession.mockReturnValueOnce(opening.promise);
    const { result } = await mounted(null);

    act(() => result.current.setInput('hi'));
    let sending!: Promise<void>;
    act(() => {
      sending = result.current.send();
    });
    await waitFor(() => expect(openCoachSession).toHaveBeenCalled());

    // They leave while the session is still being opened: there is nothing to name yet, so no
    // request can go out. The old code called notifyOnCoachReply(null) here and that was the end
    // of it — the arm was dropped on the floor and never retried.
    act(background);
    expect(armsSent()).toEqual([]);

    await act(async () => {
      opening.resolve({ sessionId: 'sess-fresh' });
      await sending;
    });
    // ...and the intent survived the wait.
    expect(armsSent()).toContain('sess-fresh');
  });

  it('says nothing when the app goes away with no turn in the air', async () => {
    // Someone who just closed the app on a finished conversation is not owed a notification, and
    // an arm with nothing to announce is what the server used to have to defend itself against.
    await mounted('sess-1');
    act(background);
    expect(armsSent()).toEqual([]);
  });

  it('does not let an unspent intent from one turn arm the next', async () => {
    const opening = deferred<{ sessionId: string }>();
    openCoachSession.mockReturnValueOnce(opening.promise);
    const { result } = await mounted(null);

    act(() => result.current.setInput('one'));
    let first!: Promise<void>;
    act(() => {
      first = result.current.send();
    });
    await waitFor(() => expect(openCoachSession).toHaveBeenCalled());
    act(background);

    // The turn dies before the session ever opens, so the intent is never spent.
    getCurrentCoach.mockResolvedValue({ sessionId: null, messages: [], stale: false });
    await act(async () => {
      opening.reject(new Error('could not open'));
      await first;
    });
    expect(armsSent()).toEqual([]);
    notifyOnCoachReply.mockClear();

    // A later turn, with the user watching, must not inherit it.
    act(() => result.current.setInput('two'));
    await act(async () => {
      await result.current.send();
    });
    expect(armsSent()).toEqual([]);
  });
});
