/**
 * The builder's job is to make three things impossible rather than merely unlikely: a nudge above
 * the user's tier, a nudge inside quiet hours, and more pending notifications than iOS will hold.
 * Each of those fails silently in production — the OS drops the overflow without an error, and a
 * 2am buzz is only ever reported by the person it woke.
 */
import { describe, it, expect } from 'vitest';
import { MAX_LOCAL_NOTIFICATIONS, type IosWeekday, type SchedulableActivity } from '../local-notifications.ts';
import { buildLocalNudges, withinQuietHours, type NudgePlanInput } from './build.ts';
import { NUDGE_CHANNEL } from './kinds.ts';
import { NUDGE_CATEGORY } from './actions.ts';
import type { LocalNotificationSpec } from '../local-notifications.ts';

/** Fail loudly on a missing spec rather than asserting through a `!`. */
function only(specs: LocalNotificationSpec[], kind: string): LocalNotificationSpec {
  const found = specs.filter((s) => s.kind === kind);
  if (found.length !== 1) throw new Error(`expected exactly one ${kind}, got ${found.length}`);
  return found[0] as LocalNotificationSpec;
}

const run = (over: Partial<SchedulableActivity> = {}): SchedulableActivity => ({
  activity_id: 'run-1',
  title: 'Easy run',
  schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=MO,WE,FR', time_of_day: '07:00' },
  ...over,
});

const input = (over: Partial<NudgePlanInput> = {}): NudgePlanInput => ({
  tier: 'lots',
  quietStartMin: 21 * 60,
  quietEndMin: 7 * 60,
  today: '2026-08-10',
  todayWeekday: 2 as IosWeekday,
  nowMinutes: 6 * 60,
  activities: [run()],
  ...over,
});

describe('tier gating happens where the notification is MADE', () => {
  it('builds nothing above the tier, so no later filter can leak one', () => {
    // quietEnd at 06:00 so the 06:45 lead is genuinely allowed — this isolates the TIER gate.
    const few = buildLocalNudges(input({ tier: 'few', quietEndMin: 6 * 60 }));
    expect(few.some((s) => s.kind === 'almost_time')).toBe(false);
    expect(
      buildLocalNudges(input({ tier: 'moderate', quietEndMin: 6 * 60 })).some((s) => s.kind === 'almost_time'),
    ).toBe(true);
  });

  it('keeps the third tier out of moderate', () => {
    const moderate = buildLocalNudges(
      input({
        tier: 'moderate',
        flexibleToday: run({ activity_id: 'flex', title: 'stretch', schedule: { recurrence: 'FREQ=DAILY' } }),
        yesterday: { done: 2, planned: 4 },
      }),
    );
    expect(moderate.some((s) => s.kind === 'before_quiet_hours')).toBe(false);
    expect(moderate.some((s) => s.kind === 'morning_adjust')).toBe(false);
  });

  it('emits only LOCAL kinds — push is the server’s job and cannot be scheduled here', () => {
    const specs = buildLocalNudges(
      input({
        flexibleToday: run({ activity_id: 'flex', title: 'stretch', schedule: { recurrence: 'FREQ=DAILY' } }),
        yesterday: { done: 1, planned: 3 },
        waypoints: [{ label: 'race day', date: '2026-09-01', weeksOut: 3 }],
      }),
    );
    expect(specs.length).toBeGreaterThan(0);
    for (const s of specs) expect(NUDGE_CHANNEL[s.kind]).toBe('local');
  });
});

describe('quiet hours are enforced by construction', () => {
  it('drops a nudge whose clock time falls inside the window', () => {
    // A 07:00 session's 15-minute lead is 06:45 — inside a 21:00→07:00 window.
    const specs = buildLocalNudges(input({ tier: 'moderate' }));
    expect(specs.some((s) => s.kind === 'almost_time')).toBe(false);
  });

  it('keeps the same nudge once the window no longer covers it', () => {
    const specs = buildLocalNudges(input({ tier: 'moderate', quietEndMin: 6 * 60 }));
    const almost = specs.filter((s) => s.kind === 'almost_time');
    expect(almost).toHaveLength(3); // Mon/Wed/Fri
    expect(almost.every((s) => s.hour === 6 && s.minute === 45)).toBe(true);
  });

  it('announces a just-after-midnight session the NIGHT BEFORE, not the same night', () => {
    // 00:05 Tuesday, minus a 15-minute lead, is 23:50 MONDAY. Shifting the clock without shifting
    // the weekday would fire it ~24 hours late — the whole point of the nudge lost, silently.
    // Quiet hours are switched off (start === end) so the wrap itself is what is under test.
    const specs = buildLocalNudges(
      input({
        quietStartMin: 0,
        quietEndMin: 0,
        activities: [run({ schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=TU', time_of_day: '00:05' } })],
      }),
    );
    const almost = only(specs, 'almost_time');
    expect({ weekday: almost.weekday, hour: almost.hour, minute: almost.minute }).toEqual({
      weekday: 2, // Monday — 1 = Sunday
      hour: 23,
      minute: 50,
    });
  });

  it('wraps a Sunday-morning session back to Saturday, not to weekday zero', () => {
    const specs = buildLocalNudges(
      input({
        quietStartMin: 0,
        quietEndMin: 0,
        activities: [run({ schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=SU', time_of_day: '00:10' } })],
      }),
    );
    expect(only(specs, 'almost_time').weekday).toBe(7); // Saturday, not 0 and not 1
  });

  it('never schedules INSIDE the window, for any activity time, on any tier', () => {
    const hours = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`);
    const specs = buildLocalNudges(
      input({
        activities: hours.map((t, i) =>
          run({ activity_id: `a${i}`, schedule: { recurrence: 'FREQ=WEEKLY;BYDAY=MO', time_of_day: t } }),
        ),
      }),
    );
    for (const s of specs) {
      expect(withinQuietHours(s.hour * 60 + s.minute, 21 * 60, 7 * 60), `${s.kind} at ${s.hour}:${s.minute}`).toBe(
        false,
      );
    }
  });

  it('reads a wrapping window the same way the server does', () => {
    expect(withinQuietHours(22 * 60, 21 * 60, 7 * 60)).toBe(true);
    expect(withinQuietHours(3 * 60, 21 * 60, 7 * 60)).toBe(true);
    expect(withinQuietHours(7 * 60, 21 * 60, 7 * 60)).toBe(false); // end-exclusive
    expect(withinQuietHours(3 * 60, 9 * 60, 9 * 60)).toBe(false); // zero-length ≠ always quiet
  });
});

describe('before_quiet_hours', () => {
  const flex = run({ activity_id: 'flex', title: 'stretch', schedule: { recurrence: 'FREQ=DAILY' } });

  it('lands ~45 minutes before the window opens, as a one-shot for today', () => {
    const spec = only(buildLocalNudges(input({ activities: [], flexibleToday: flex })), 'before_quiet_hours');
    expect(spec.hour).toBe(20);
    expect(spec.minute).toBe(15);
    expect(spec.date).toBe('2026-08-10');
    expect(spec.weekday).toBeNull();
    expect(spec.title).toBe('Your stretch still fits');
  });

  it('does not fire without a flexible activity still open today', () => {
    expect(buildLocalNudges(input({ activities: [] })).some((s) => s.kind === 'before_quiet_hours')).toBe(false);
  });

  it('is dropped once its slot is behind us — a nudge about tonight, sent tonight', () => {
    const late = buildLocalNudges(input({ activities: [], flexibleToday: flex, nowMinutes: 20 * 60 + 30 }));
    expect(late.some((s) => s.kind === 'before_quiet_hours')).toBe(false);
  });
});

describe('morning_adjust', () => {
  it('fires this morning about yesterday, carrying the lighter day it offers', () => {
    const lighter = { swap: 'short' };
    const spec = only(
      buildLocalNudges(input({ activities: [], yesterday: { done: 2, planned: 4 }, lighterVariant: lighter })),
      'morning_adjust',
    );
    expect(spec.title).toBe('Yesterday: 2 of 4');
    expect(spec.hour).toBe(8);
    expect(spec.date).toBe('2026-08-10');
    // Composed at SCHEDULE time — the tap must not have to work anything out.
    expect(spec.extra?.lighter).toBe(lighter);
    expect(spec.actionTypeId).toBe(NUDGE_CATEGORY.morningAdjust);
  });

  it('says nothing when yesterday was fully kept — there is nothing to lighten', () => {
    const specs = buildLocalNudges(input({ activities: [], yesterday: { done: 4, planned: 4 } }));
    expect(specs.some((s) => s.kind === 'morning_adjust')).toBe(false);
  });

  it('says nothing when nothing was planned — an empty day is not a shortfall', () => {
    const specs = buildLocalNudges(input({ activities: [], yesterday: { done: 0, planned: 0 } }));
    expect(specs.some((s) => s.kind === 'morning_adjust')).toBe(false);
  });

  it('is silent when the caller withheld yesterday — a freeze or a detour already explained it', () => {
    // Suppression lives with the caller because only it knows about the freeze and the detour;
    // the builder's contract is simply that no `yesterday` means no notification about it.
    expect(buildLocalNudges(input({ activities: [] })).some((s) => s.kind === 'morning_adjust')).toBe(false);
  });

  it('is dropped once the morning has gone — at 3pm this would be a verdict, not an offer', () => {
    const specs = buildLocalNudges(input({ activities: [], yesterday: { done: 2, planned: 4 }, nowMinutes: 15 * 60 }));
    expect(specs.some((s) => s.kind === 'morning_adjust')).toBe(false);
  });
});

describe('milestone_waypoint', () => {
  const waypoints = [
    { label: 'race day', date: '2026-08-20', weeksOut: 3 },
    { label: 'race day', date: '2026-08-01', weeksOut: 6 }, // already past
  ];

  it('schedules future waypoints only', () => {
    const spec = only(buildLocalNudges(input({ activities: [], waypoints })), 'milestone_waypoint');
    expect(spec.date).toBe('2026-08-20');
    expect(spec.title).toBe('Three weeks to race day');
  });

  it('schedules none when the caller passes none — the detour case', () => {
    expect(buildLocalNudges(input({ activities: [] })).some((s) => s.kind === 'milestone_waypoint')).toBe(false);
  });
});

describe('ids and the ceiling', () => {
  it('gives every spec a distinct positive id, so a re-sync replaces rather than stacks', () => {
    const specs = buildLocalNudges(
      input({
        quietEndMin: 5 * 60,
        flexibleToday: run({ activity_id: 'flex', title: 'stretch', schedule: { recurrence: 'FREQ=DAILY' } }),
        yesterday: { done: 1, planned: 2 },
        waypoints: [{ label: 'race day', date: '2026-08-20', weeksOut: 3 }],
      }),
    );
    const ids = specs.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toBeGreaterThan(0);
  });

  it('is stable across builds with the same input', () => {
    const a = buildLocalNudges(input({ quietEndMin: 5 * 60 }));
    const b = buildLocalNudges(input({ quietEndMin: 5 * 60 }));
    expect(a).toEqual(b);
  });

  it('caps below the iOS ceiling, dropping the far end of the week rather than a random subset', () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      run({ activity_id: `a${i}`, schedule: { recurrence: 'FREQ=DAILY', time_of_day: '12:00' } }),
    );
    const specs = buildLocalNudges(input({ activities: many }));
    expect(specs).toHaveLength(MAX_LOCAL_NOTIFICATIONS);
  });

  it('puts dated one-shots first — they are worthless a day late, repeats are not', () => {
    const specs = buildLocalNudges(
      input({
        quietEndMin: 5 * 60,
        yesterday: { done: 1, planned: 2 },
      }),
    );
    const firstRepeat = specs.findIndex((s) => s.date === null);
    const lastDated = specs.map((s) => s.date !== null).lastIndexOf(true);
    expect(lastDated).toBeLessThan(firstRepeat);
  });

  it('handles an empty plan without throwing', () => {
    expect(buildLocalNudges(input({ activities: [] }))).toEqual([]);
  });
});
