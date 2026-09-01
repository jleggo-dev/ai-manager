/**
 * Direct coverage of the hook itself, same idiom as its coach-routine sibling's own suite
 * (`plan/quick-add/useRoutinePlay.test.tsx`) — a `UserRoutine` already carries its full session, so
 * there is no fetch/busy phase to cover here, only play → derive → credit-on-complete.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import type { UserRoutine } from '../../lib/api.ts';
import { useUserRoutinePlay } from './useUserRoutinePlay.tsx';

const logUserRoutineRun = vi.fn(async (..._a: unknown[]) => ({ ok: true }));
vi.mock('../../lib/api.ts', () => ({
  logUserRoutineRun: (...a: unknown[]) => logUserRoutineRun(...a),
}));

const ROUTINE: UserRoutine = {
  routine_id: 'r1',
  name: 'Hotel HIIT',
  session: {
    blocks: [{ label: '', items: [{ name: 'Warm-up', duration_min: 5 }] }],
    note: '',
    generated_at: '',
    version: 1,
  },
  provenance: { kind: 'blank' },
  created_at: '',
  updated_at: '',
  runs: 4,
  last_run: null,
  schedule: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('useUserRoutinePlay', () => {
  it('starts idle: no node, no active id', () => {
    const { result } = renderHook(() => useUserRoutinePlay(vi.fn()));
    expect(result.current.node).toBeNull();
    expect(result.current.activeId).toBeNull();
  });

  it('play() opens the walkthrough straight from routine.session — no fetch involved', () => {
    const { result } = renderHook(() => useUserRoutinePlay(vi.fn()));
    act(() => result.current.play(ROUTINE));
    expect(result.current.activeId).toBe('r1');
    const node = result.current.node as { props: { title: string; walkthrough: { steps: unknown[] } } };
    expect(node.props.title).toBe('Hotel HIIT');
    expect(Array.isArray(node.props.walkthrough.steps)).toBe(true);
  });

  it('completing the walkthrough credits the routine, THEN calls onLogged, and clears the node', async () => {
    const order: string[] = [];
    const onLogged = vi.fn((id: string) => order.push(`onLogged:${id}`));
    logUserRoutineRun.mockImplementation(async (...args: unknown[]) => {
      order.push(`logUserRoutineRun:${args[0] as string}`);
      return { ok: true };
    });
    const { result } = renderHook(() => useUserRoutinePlay(onLogged));
    act(() => result.current.play(ROUTINE));

    const node = result.current.node as { props: { onComplete: () => void } };
    act(() => node.props.onComplete());
    await waitFor(() => expect(onLogged).toHaveBeenCalled());
    expect(order).toEqual(['logUserRoutineRun:r1', 'onLogged:r1']);
    await waitFor(() => expect(result.current.node).toBeNull());
  });

  it('a failed credit write still calls onLogged — never strands the finished screen', async () => {
    logUserRoutineRun.mockResolvedValue({ ok: false });
    const onLogged = vi.fn();
    const { result } = renderHook(() => useUserRoutinePlay(onLogged));
    act(() => result.current.play(ROUTINE));

    const node = result.current.node as { props: { onComplete: () => void } };
    act(() => node.props.onComplete());
    await waitFor(() => expect(onLogged).toHaveBeenCalledWith('r1'));
  });

  it('closing without finishing clears the node and never calls logUserRoutineRun or onLogged', () => {
    const onLogged = vi.fn();
    const { result } = renderHook(() => useUserRoutinePlay(onLogged));
    act(() => result.current.play(ROUTINE));

    const node = result.current.node as { props: { onClose: () => void } };
    act(() => node.props.onClose());
    expect(logUserRoutineRun).not.toHaveBeenCalled();
    expect(onLogged).not.toHaveBeenCalled();
  });
});
