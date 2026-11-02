import { describe, expect, it } from 'vitest';
import type { Activity, PendingPlanActivity } from '@cadence/shared';
import { buildProposedWeek, type ProposedRow } from './plan-change-week.ts';

/**
 * The Changes sheet's full-height week (owner ask 2026-11-01): seven days, grouped by day, the
 * change marked. 2026-11-01 is a Sunday; both anchors sit on it so weekly patterns land plainly.
 */

const FROM = '2026-11-01';
const TO = '2026-11-07';

function current(id: string, title: string, recurrence: string, time: string, minutes = 30, how_to?: string): Activity {
  return {
    activity_id: `a-${id}`,
    commitment_id: id,
    plan_id: 'p1',
    title,
    kind: 'user',
    schedule: { recurrence, time_of_day: time, duration_min: minutes },
    ...(how_to ? { how_to } : {}),
    completion_source: 'self_report',
  };
}

function asRow(a: Activity, over: Partial<PendingPlanActivity> = {}): PendingPlanActivity {
  return {
    commitment_id: a.commitment_id,
    title: a.title,
    kind: a.kind,
    cadence: '',
    recurrence: a.schedule.recurrence,
    time_of_day: a.schedule.time_of_day,
    duration_min: a.schedule.duration_min,
    completion_source: 'self_report',
    ...over,
  };
}

const RUN = current('run', 'Easy run', 'FREQ=WEEKLY;BYDAY=WE', '06:00', 35);
const STRENGTH = current('str', 'Obstacle strength', 'FREQ=WEEKLY;BYDAY=SU', '16:30', 45, 'Bike warm-up first.');
const PIANO = current('pno', 'Piano practice', 'FREQ=WEEKLY;BYDAY=MO,WE,FR', '20:00');

function week(proposed: ProposedRow[], cur: Activity[] = [RUN, STRENGTH, PIANO]) {
  const days = buildProposedWeek({ proposed, current: cur, from: FROM, to: TO, currentAnchor: FROM, proposedAnchor: FROM });
  return Object.fromEntries(days.map((d) => [d.date, d.entries.map((e) => `${e.kind}:${e.title}${e.index != null ? `#${e.index}` : ''}`)]));
}

describe('buildProposedWeek', () => {
  it('gives every one of the seven days, empty ones included', () => {
    const days = buildProposedWeek({ proposed: [], current: [], from: FROM, to: TO, currentAnchor: FROM, proposedAnchor: FROM });
    expect(days.map((d) => d.date)).toEqual([FROM, '2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06', TO]);
    expect(days.every((d) => d.entries.length === 0)).toBe(true);
  });

  it("a swap inside today's session marks that one session changed, every other session the same", () => {
    const w = week([
      { row: asRow(RUN), index: 0, changed: false },
      { row: asRow(STRENGTH, { how_to: 'Five minutes of step-ups first.' }), index: 1, changed: true },
      { row: asRow(PIANO), index: 2, changed: false },
    ]);
    expect(w[FROM]).toEqual(['changed:Obstacle strength#1']);
    expect(w['2026-11-04']).toEqual(['same:Easy run', 'same:Piano practice']);
  });

  it('a session that moves days is gone from the old day and new on the next', () => {
    const w = week([
      { row: asRow(RUN, { recurrence: 'FREQ=WEEKLY;BYDAY=TH' }), index: 0, changed: true },
      { row: asRow(STRENGTH), index: 1, changed: false },
      { row: asRow(PIANO), index: 2, changed: false },
    ]);
    expect(w['2026-11-04']).toEqual(['was:Easy run#0', 'same:Piano practice']);
    expect(w['2026-11-05']).toEqual(['new:Easy run#0']);
  });

  it('a retime on the same day says the time it had', () => {
    const days = buildProposedWeek({
      proposed: [{ row: asRow(RUN, { time_of_day: '18:00' }), index: 0, changed: true }],
      current: [RUN],
      from: FROM,
      to: TO,
      currentAnchor: FROM,
      proposedAnchor: FROM,
    });
    expect(days[3]!.entries).toEqual([
      { title: 'Easy run', time: '6 pm', minutes: 35, kind: 'changed', index: 0, was_time: '6 am' },
    ]);
  });

  it('a contents-only change carries no was_time — the time did not move', () => {
    const days = buildProposedWeek({
      proposed: [{ row: asRow(STRENGTH, { how_to: 'Step-ups.' }), index: 0, changed: true }],
      current: [STRENGTH],
      from: FROM,
      to: TO,
      currentAnchor: FROM,
      proposedAnchor: FROM,
    });
    expect(days[0]!.entries[0]).not.toHaveProperty('was_time');
  });

  it('an add is new on its days; a dropped commitment is `was` with no index to toggle', () => {
    const sauna: PendingPlanActivity = {
      title: 'Sauna',
      kind: 'user',
      cadence: '',
      recurrence: 'FREQ=WEEKLY;BYDAY=SA',
      time_of_day: '19:00',
      completion_source: 'self_report',
    };
    const w = week([
      { row: asRow(RUN), index: 0, changed: false },
      { row: asRow(STRENGTH), index: 1, changed: false },
      { row: sauna, index: 2, changed: true },
    ]);
    expect(w[TO]).toEqual(['new:Sauna#2']);
    expect(w['2026-11-02']).toEqual(['was:Piano practice']);
  });

  it('orders each day by clock time, with a time-less session last', () => {
    const early = current('e', 'Box breathing', 'FREQ=DAILY', '07:00');
    const free = current('f', 'Stretch', 'FREQ=DAILY', '');
    const late = current('l', 'Journal', 'FREQ=DAILY', '21:00');
    const w = week(
      [late, free, early].map((a, i) => ({ row: asRow(a), index: i, changed: false })),
      [late, free, early],
    );
    expect(w[FROM]).toEqual(['same:Box breathing', 'same:Journal', 'same:Stretch']);
  });
});
