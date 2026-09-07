/**
 * The hold menu, pressed at the wire — every button, and the doors that only open silently when
 * wrong: a done row offering "do it now", a future task moved without the ask, an every-day task
 * moved without the second ask, and a taken day pickable in the day list.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import type { PlanDay, PlanOccurrence } from '../../../lib/api.ts';
import { TaskHoldMenu, type HoldScreen } from './TaskHoldMenu.tsx';

const TODAY = '2026-09-07';

const occ = (over: Partial<PlanOccurrence> = {}): PlanOccurrence => ({
  occurrence_id: 'o1',
  activity_id: 'run',
  title: 'Easy run',
  kind: 'user',
  status: 'pending',
  ...over,
});

const day = (date: string, weekday: string, dayNum: number, occurrences: PlanOccurrence[] = []): PlanDay => ({
  date,
  weekday,
  dayNum,
  isToday: date === TODAY,
  occurrences,
});

const WEEK = [
  day('2026-09-07', 'Mon', 7, [
    occ({ occurrence_id: 'lunch-today', activity_id: 'lunch', title: 'Log lunch', kind: 'system' }),
  ]),
  day('2026-09-08', 'Tue', 8, [occ({ occurrence_id: 'o1', activity_id: 'run' })]),
  day('2026-09-09', 'Wed', 9, [
    occ({ occurrence_id: 'lunch-wed', activity_id: 'lunch', title: 'Log lunch', kind: 'system' }),
  ]),
];
const ACTS = [{ activity_id: 'lunch', recurrence: 'FREQ=DAILY' }];

function mount(o: PlanOccurrence, date: string, over: Partial<Record<string, unknown>> = {}, screen?: HoldScreen) {
  const handlers = {
    onClose: vi.fn(),
    onMove: vi.fn(),
    onDuplicate: vi.fn(),
    onDelete: vi.fn(),
    onDoNow: vi.fn(),
    onOpen: vi.fn(),
  };
  render(
    <TaskHoldMenu
      occ={o}
      date={date}
      todayIso={TODAY}
      week={WEEK}
      activities={ACTS}
      busy={false}
      error={null}
      initialScreen={screen}
      {...handlers}
      {...over}
    />,
  );
  return handlers;
}

afterEach(cleanup);

describe('TaskHoldMenu — the first screen', () => {
  it('offers all four rows on a pending task this week', () => {
    mount(occ(), '2026-09-08');
    for (const label of ['Do it now', 'Move to another day', 'Copy to another day', 'Take it off the plan']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
  });

  it('a done task loses "do it now" and keeps the rest', () => {
    mount(occ({ status: 'done' }), '2026-09-08');
    expect(screen.queryByText('Do it now')).toBeNull();
    expect(screen.getByText('Move to another day')).toBeTruthy();
    expect(screen.getByText('Take it off the plan')).toBeTruthy();
  });

  it('a skipped task keeps "do it now" — skipped is not finished', () => {
    mount(occ({ status: 'skipped' }), '2026-09-07');
    expect(screen.getByText('Do it now')).toBeTruthy();
  });

  it("a task from last week can be moved and copied, but 'do it now' is not offered", () => {
    mount(occ(), '2026-09-02');
    expect(screen.queryByText('Do it now')).toBeNull();
    expect(screen.getByText('Move to another day')).toBeTruthy();
  });

  it('Cancel and the scrim close it', () => {
    const h = mount(occ(), '2026-09-08');
    fireEvent.click(screen.getByText('Cancel'));
    expect(h.onClose).toHaveBeenCalledTimes(1);
  });
});

describe('TaskHoldMenu — do it now', () => {
  it("today's task opens straight away, nothing moves", () => {
    const h = mount(occ({ occurrence_id: 'o-today' }), '2026-09-07');
    fireEvent.click(screen.getByText('Do it now'));
    expect(h.onOpen).toHaveBeenCalledWith('o-today');
    expect(h.onDoNow).not.toHaveBeenCalled();
  });

  it("tomorrow's run asks, then moves onto today", () => {
    const h = mount(occ(), '2026-09-08');
    fireEvent.click(screen.getByText('Do it now'));
    expect(h.onDoNow).not.toHaveBeenCalled();
    expect(screen.getByText('Move it to today and do it now?')).toBeTruthy();
    fireEvent.click(screen.getByText('Move it to today'));
    expect(h.onDoNow).toHaveBeenCalledTimes(1);
    expect(h.onOpen).not.toHaveBeenCalled();
  });

  it("Wednesday's lunch — an every-day task — asks twice, then opens today's own lunch", () => {
    const h = mount(
      occ({ occurrence_id: 'lunch-wed', activity_id: 'lunch', title: 'Log lunch', kind: 'system' }),
      '2026-09-09',
    );
    fireEvent.click(screen.getByText('Do it now'));
    expect(screen.getByText(/Today already has its own Log lunch/)).toBeTruthy();
    fireEvent.click(screen.getByText("Open today's"));
    // The second ask — nothing has happened yet.
    expect(h.onOpen).not.toHaveBeenCalled();
    expect(screen.getByText('Log lunch comes round every day.')).toBeTruthy();
    fireEvent.click(screen.getByText("Yes, I'm sure"));
    expect(h.onOpen).toHaveBeenCalledWith('lunch-today');
    expect(h.onDoNow).not.toHaveBeenCalled();
  });

  it('an every-day task with no twin today asks twice, then moves', () => {
    const week = [
      day('2026-09-07', 'Mon', 7),
      day('2026-09-09', 'Wed', 9, [occ({ occurrence_id: 'lunch-wed', activity_id: 'lunch' })]),
    ];
    const h = mount(
      occ({ occurrence_id: 'lunch-wed', activity_id: 'lunch', title: 'Log lunch', kind: 'system' }),
      '2026-09-09',
      {
        week,
      },
    );
    fireEvent.click(screen.getByText('Do it now'));
    fireEvent.click(screen.getByText('Move it to today'));
    expect(screen.getByText(/leaves Wed 9 without one/)).toBeTruthy();
    fireEvent.click(screen.getByText("Yes, I'm sure"));
    expect(h.onDoNow).toHaveBeenCalledTimes(1);
  });

  it('the preview can land straight on the ask', () => {
    mount(occ(), '2026-09-08', {}, 'do-now');
    expect(screen.getByText('Move it to today and do it now?')).toBeTruthy();
  });
});

describe('TaskHoldMenu — move, copy, delete', () => {
  it('the move list offers this week, with days that already hold the task greyed', () => {
    const h = mount(occ(), '2026-09-08');
    fireEvent.click(screen.getByText('Move to another day'));
    expect(screen.getByText('Move Easy run to…')).toBeTruthy();
    const tomorrow = screen.getByText('Tomorrow').closest('button')!;
    expect(tomorrow.disabled).toBe(true); // its own day
    expect(screen.getByText('already here')).toBeTruthy();
    fireEvent.click(screen.getByText('Wed 9'));
    expect(h.onMove).toHaveBeenCalledWith('2026-09-09');
    expect(h.onDuplicate).not.toHaveBeenCalled();
  });

  it('the copy list picks the same way, into onDuplicate', () => {
    const h = mount(occ(), '2026-09-08');
    fireEvent.click(screen.getByText('Copy to another day'));
    expect(screen.getByText('Copy Easy run to…')).toBeTruthy();
    fireEvent.click(screen.getByText('Today'));
    expect(h.onDuplicate).toHaveBeenCalledWith('2026-09-07');
    expect(h.onMove).not.toHaveBeenCalled();
  });

  it('delete asks first, and Back returns without deleting', () => {
    const h = mount(occ(), '2026-09-08');
    fireEvent.click(screen.getByText('Take it off the plan'));
    expect(h.onDelete).not.toHaveBeenCalled();
    expect(screen.getByText('Take Easy run off Tomorrow?')).toBeTruthy();
    fireEvent.click(screen.getByText('Back'));
    expect(screen.getByText('Move to another day')).toBeTruthy();
    expect(h.onDelete).not.toHaveBeenCalled();
  });

  it('delete, confirmed, deletes', () => {
    const h = mount(occ(), '2026-09-08');
    fireEvent.click(screen.getByText('Take it off the plan'));
    fireEvent.click(screen.getByText('Take it off'));
    expect(h.onDelete).toHaveBeenCalledTimes(1);
  });

  it('a failure line shows, and busy holds the buttons', () => {
    mount(occ(), '2026-09-08', { error: "That didn't take — try again in a moment.", busy: true });
    expect(screen.getByRole('alert').textContent).toMatch(/didn't take/);
    expect((screen.getByText('Do it now').closest('button') as HTMLButtonElement).disabled).toBe(true);
  });
});
