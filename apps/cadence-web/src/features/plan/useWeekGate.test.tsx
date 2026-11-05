/**
 * The gate, wired (useWeekGate.ts): what a tap on the trail becomes. The gate's own table is in
 * checkinGate.test.ts; this pins the routing around it — the check-in node starts the check-in
 * with no prompt, a stand-in node never opens, an ordinary tap opens the task, and a gated tap
 * puts up the sheet instead of opening anything.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render } from '@testing-library/react';
import type { PlanOccurrence, PlanViewData } from '../../lib/api.ts';
import { readLaterOn, writeLaterOn } from './checkinGate.ts';
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
      week: [{ date: '2026-09-14', isToday: true, occurrences: [] }],
    } as unknown as PlanViewData;
    const { openTask } = mount(due);
    act(() => latest.tap(occ(), '2026-09-14'));
    expect(latest.gate?.variant).toBe('due');
    act(() => latest.later());
    expect(latest.gate).toBeNull();
    expect(openTask).toHaveBeenCalledWith(expect.objectContaining({ occurrence_id: 'o1' }), '2026-09-14');
    // Quiet for the rest of the day: the next tap opens straight away.
    act(() => latest.tap(occ({ occurrence_id: 'o2' }), '2026-09-14'));
    expect(latest.gate).toBeNull();
    expect(openTask).toHaveBeenCalledTimes(2);
  });

  it("the check-in's own day is a day of tasks — piano opens, no sheet (owner, 2026-11-03)", () => {
    const CHECKIN_DAY = {
      week: [{ date: '2026-11-03', isToday: true, occurrences: [] }],
      weekState: { ends_on: '2026-11-03', checkin_due: true, started_on: '2026-10-27', built_through: null },
    } as unknown as PlanViewData;
    const { openTask, onStartCheckIn } = mount(CHECKIN_DAY);
    act(() => latest.tap(occ({ title: 'Piano practice' }), '2026-11-03'));
    expect(latest.gate).toBeNull();
    expect(openTask).toHaveBeenCalledTimes(1);
    // And the check-in is still there to take, as one of the day's tasks.
    act(() =>
      latest.tap(occ({ occurrence_id: 'checkin:2026-11-03', title: 'Weekly check-in', kind: 'system' }), '2026-11-03'),
    );
    expect(onStartCheckIn).toHaveBeenCalledTimes(1);
    expect(latest.gate).toBeNull();
  });

  describe('the due ask comes once a day, however it is answered', () => {
    /** A day past the check-in, nothing built: today Nov 4, `ends_on` Nov 3, Nov 5 on is locked. */
    const OVERDUE = {
      week: [{ date: '2026-11-04', isToday: true, occurrences: [] }],
      weekState: { ends_on: '2026-11-03', checkin_due: true, started_on: '2026-10-27', built_through: null },
    } as unknown as PlanViewData;

    it('Cancel opens nothing, and the next tap on today goes straight through', () => {
      const { openTask } = mount(OVERDUE);
      act(() => latest.tap(occ(), '2026-11-04'));
      expect(latest.gate).toMatchObject({ variant: 'due' });
      act(() => latest.close());
      expect(latest.gate).toBeNull();
      expect(openTask).not.toHaveBeenCalled();
      act(() => latest.tap(occ(), '2026-11-04'));
      expect(latest.gate).toBeNull();
      expect(openTask).toHaveBeenCalledTimes(1);
    });

    it('a locked day still asks after Cancel — the prompt is the only door it has', () => {
      mount(OVERDUE);
      act(() => latest.tap(occ(), '2026-11-04'));
      act(() => latest.close());
      act(() => latest.tap(occ({ occurrence_id: 'preview:2026-11-05:0' }), '2026-11-05'));
      expect(latest.gate).toMatchObject({ variant: 'due', locked: true });
    });

    it('a day-old Cancel does not carry over — tomorrow asks again', () => {
      writeLaterOn('2026-11-03');
      mount(OVERDUE);
      act(() => latest.tap(occ(), '2026-11-04'));
      expect(latest.gate).toMatchObject({ variant: 'due' });
    });

    it('closing the mid-week ask remembers nothing — "Just browsing" is not an answer to the due ask', () => {
      mount(PLAN);
      act(() => latest.tap(occ({ occurrence_id: 'preview:2026-09-15:0' }), '2026-09-15'));
      act(() => latest.close());
      expect(readLaterOn()).toBeNull();
    });
  });

  it('holds nothing and gates nothing before the plan lands', () => {
    const { openTask } = mount(undefined);
    expect(latest.wallAt).toBeNull();
    act(() => latest.tap(occ(), '2026-09-10'));
    expect(openTask).toHaveBeenCalledTimes(1);
  });
});
