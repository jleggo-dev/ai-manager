/**
 * The gate, wired (useWeekGate.ts): what a tap on the trail becomes. The gate's own table is in
 * checkinGate.test.ts; this pins the routing around it — the check-in node starts the check-in
 * with no prompt, a stand-in node never opens, an ordinary tap opens the task, and a gated tap
 * puts up the sheet instead of opening anything.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render } from '@testing-library/react';
import type { PlanOccurrence, PlanViewData } from '../../lib/api.ts';
import { useWeekGate } from './useWeekGate.ts';

vi.mock('../../lib/api.ts', () => ({ buildNextWeek: vi.fn(), buildWeekAhead: vi.fn() }));

type Gate = ReturnType<typeof useWeekGate>;
let latest: Gate;
function Harness(props: Parameters<typeof useWeekGate>[0]) {
  latest = useWeekGate(props);
  return null;
}

const occ = (over: Partial<PlanOccurrence> = {}): PlanOccurrence => ({
  occurrence_id: 'o1',
  activity_id: 'a1',
  title: 'Easy run',
  kind: 'user',
  status: 'pending',
  ...over,
});

/** A week three days in: today Sep 9, check-in Sep 13, nothing built past it. */
const PLAN = {
  week: [{ date: '2026-09-09', isToday: true, occurrences: [] }],
  weekState: { ends_on: '2026-09-13', checkin_due: false, started_on: '2026-09-06', built_through: null },
} as unknown as PlanViewData;

const mount = (plan: PlanViewData | undefined) => {
  const openTask = vi.fn();
  const onStartCheckIn = vi.fn();
  render(<Harness plan={plan} openTask={openTask} onStartCheckIn={onStartCheckIn} onChanged={vi.fn()} />);
  return { openTask, onStartCheckIn };
};

beforeEach(() => {
  localStorage.clear();
});

describe('useWeekGate — what a tap becomes', () => {
  it('the check-in node starts the check-in at once, no prompt, nothing opened', () => {
    const { openTask, onStartCheckIn } = mount(PLAN);
    act(() =>
      latest.tap(occ({ occurrence_id: 'checkin:2026-09-13', title: 'Weekly check-in', kind: 'system' }), '2026-09-13'),
    );
    expect(onStartCheckIn).toHaveBeenCalledTimes(1);
    expect(openTask).not.toHaveBeenCalled();
    expect(latest.gate).toBeNull();
  });

  it('an ordinary tap on an open day opens the task', () => {
    const { openTask } = mount(PLAN);
    act(() => latest.tap(occ(), '2026-09-10'));
    expect(openTask).toHaveBeenCalledWith(expect.objectContaining({ occurrence_id: 'o1' }), '2026-09-10');
    expect(latest.gate).toBeNull();
  });

  it('a tap on a locked day puts up the sheet instead — the three-way ask on day 4', () => {
    const { openTask } = mount(PLAN);
    act(() => latest.tap(occ({ occurrence_id: 'preview:2026-09-15:0' }), '2026-09-15'));
    expect(openTask).not.toHaveBeenCalled();
    expect(latest.gate).toMatchObject({ variant: 'midweek', day: 4, date: '2026-09-15', locked: true });
  });

  it('knows where the wall and the lock stand', () => {
    mount(PLAN);
    expect(latest.wallAt).toBe('2026-09-14');
    expect(latest.lockedFrom).toBe('2026-09-14');
  });

  it('"later today" opens what was tapped when it is a real row on an open day, and remembers the day', () => {
    const due = {
      ...PLAN,
      week: [{ date: '2026-09-13', isToday: true, occurrences: [] }],
    } as unknown as PlanViewData;
    const { openTask } = mount(due);
    act(() => latest.tap(occ(), '2026-09-13'));
    expect(latest.gate?.variant).toBe('due');
    act(() => latest.later());
    expect(latest.gate).toBeNull();
    expect(openTask).toHaveBeenCalledWith(expect.objectContaining({ occurrence_id: 'o1' }), '2026-09-13');
    // Quiet for the rest of the day: the next tap opens straight away.
    act(() => latest.tap(occ({ occurrence_id: 'o2' }), '2026-09-13'));
    expect(latest.gate).toBeNull();
    expect(openTask).toHaveBeenCalledTimes(2);
  });

  it('holds nothing and gates nothing before the plan lands', () => {
    const { openTask } = mount(undefined);
    expect(latest.wallAt).toBeNull();
    act(() => latest.tap(occ(), '2026-09-10'));
    expect(openTask).toHaveBeenCalledTimes(1);
  });
});
