/**
 * Direct coverage of the hook itself (not just through QuickAddTense) — it's reused verbatim by
 * the shortcut-pill parcel, so its own contract (busyId lifecycle, which row an error belongs to,
 * the play-then-credit order) needs to hold on its own, not only when mounted inside a screen.
 */
import { renderHook, waitFor } from '@testing-library/react';
import type { PlanRoutine } from '../../../lib/api.ts';
import { useRoutinePlay } from './useRoutinePlay.tsx';

const getRoutineSession = vi.fn();
const logDid = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
vi.mock('../../../lib/api.ts', () => ({
  getRoutineSession: (...a: unknown[]) => getRoutineSession(...a),
  logDid: (...a: unknown[]) => logDid(...a),
}));

const ROUTINE: PlanRoutine = {
  commitment_id: 'c1',
  activity_id: 'act1',
  title: 'Easy 5k',
  area: 'movement',
  steps: ['Warm-up', 'Zone 2', 'Stretch'],
  finishes: 11,
  last_done: null,
  on_plan: true,
};
const SESSION = {
  blocks: [{ label: '', items: [{ name: 'Warm-up', duration_min: 5 }] }],
  note: '',
  generated_at: '',
  version: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useRoutinePlay', () => {
  it('starts idle: no node, no busy row, no error', () => {
    const { result } = renderHook(() => useRoutinePlay(vi.fn()));
    expect(result.current.node).toBeNull();
    expect(result.current.busyId).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('play() marks the routine busy while its session fetch is in flight, then opens it', async () => {
    // A controlled promise, not `mockResolvedValue` — busyId is transient (set, then cleared the
    // moment the fetch settles), so a mock that resolves near-instantly races the assertion; this
    // holds the fetch open until the test has actually observed the busy state.
    let resolveFetch!: (v: { ok: boolean; session: unknown }) => void;
    getRoutineSession.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      }),
    );
    const { result } = renderHook(() => useRoutinePlay(vi.fn()));
    result.current.play(ROUTINE);
    await waitFor(() => expect(result.current.busyId).toBe('c1'));
    expect(getRoutineSession).toHaveBeenCalledWith('c1');

    resolveFetch({ ok: true, session: SESSION });
    await waitFor(() => expect(result.current.node).not.toBeNull());
    expect(result.current.busyId).toBeNull();
    // The node is the real Walkthrough element, wired with this routine's title and the derived
    // walkthrough — the pill parcel can render it with no further assembly.
    const node = result.current.node as { props: { title: string; walkthrough: { steps: unknown[] } } };
    expect(node.props.title).toBe('Easy 5k');
    expect(Array.isArray(node.props.walkthrough.steps)).toBe(true);
  });

  it('completing the walkthrough credits activity_id, THEN calls onLogged, and clears the node', async () => {
    getRoutineSession.mockResolvedValue({ ok: true, session: SESSION });
    const order: string[] = [];
    const onLogged = vi.fn(() => order.push('onLogged'));
    logDid.mockImplementation(async (...args: unknown[]) => {
      order.push(`logDid:${args[0] as string}`);
      return { ok: true };
    });
    const { result } = renderHook(() => useRoutinePlay(onLogged));
    result.current.play(ROUTINE);
    await waitFor(() => expect(result.current.node).not.toBeNull());

    const node = result.current.node as { props: { onComplete: () => void } };
    node.props.onComplete();
    await waitFor(() => expect(onLogged).toHaveBeenCalled());
    expect(order).toEqual(['logDid:act1', 'onLogged']);
    await waitFor(() => expect(result.current.node).toBeNull());
  });

  it('closing without finishing clears the node and never calls logDid or onLogged', async () => {
    getRoutineSession.mockResolvedValue({ ok: true, session: SESSION });
    const onLogged = vi.fn();
    const { result } = renderHook(() => useRoutinePlay(onLogged));
    result.current.play(ROUTINE);
    await waitFor(() => expect(result.current.node).not.toBeNull());

    const node = result.current.node as { props: { onClose: () => void } };
    node.props.onClose();
    await waitFor(() => expect(result.current.node).toBeNull());
    expect(logDid).not.toHaveBeenCalled();
    expect(onLogged).not.toHaveBeenCalled();
  });

  it('ok: false is a fetch failure, not "no session" — the honest line says try again', async () => {
    getRoutineSession.mockResolvedValue({ ok: false, session: null });
    const { result } = renderHook(() => useRoutinePlay(vi.fn()));
    result.current.play(ROUTINE);
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error).toEqual({
      commitmentId: 'c1',
      text: "Couldn't open that one just now — try again in a moment.",
    });
    expect(result.current.node).toBeNull();
  });

  it('ok: true with session: null is a vanished cache, not a fetch failure — a plainer line', async () => {
    getRoutineSession.mockResolvedValue({ ok: true, session: null });
    const { result } = renderHook(() => useRoutinePlay(vi.fn()));
    result.current.play(ROUTINE);
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.text).toBe('Nothing to play there right now — try again in a moment.');
  });

  it('a new play() clears the previous error, even for a different routine', async () => {
    getRoutineSession.mockResolvedValueOnce({ ok: false, session: null });
    const { result } = renderHook(() => useRoutinePlay(vi.fn()));
    result.current.play(ROUTINE);
    await waitFor(() => expect(result.current.error).not.toBeNull());

    getRoutineSession.mockResolvedValueOnce({ ok: true, session: SESSION });
    result.current.play({ ...ROUTINE, commitment_id: 'c2', activity_id: 'act2' });
    await waitFor(() => expect(result.current.error).toBeNull());
  });
});
