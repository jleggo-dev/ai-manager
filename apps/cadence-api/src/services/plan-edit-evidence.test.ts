import { describe, expect, it } from 'vitest';
import type { PendingPlanActivity } from '@cadence/shared';
import { constraintChecklist, planEditEvidence, proposedWeekShape, timeCollisions } from './plan-edit-evidence.ts';

/**
 * The evidence report `propose_plan_change` appends to its return (owner ruling 2026-08-31: the
 * coach IS the planner — guards return evidence with the result, she adjudicates). The scar these
 * tests replay: on 2026-08-31 the owner's proposed week stacked hill intervals + an early run +
 * mobility on a Wednesday whose own constraint said ONE workout, no afternoons — and no tool
 * noticed, because the tool's return was only the diff lines.
 */

const act = (
  title: string,
  recurrence: string,
  time_of_day?: string,
  kind: 'user' | 'system' = 'user',
): PendingPlanActivity => ({
  title,
  kind,
  cadence: '',
  recurrence,
  ...(time_of_day ? { time_of_day } : {}),
  completion_source: 'self_report',
});

describe('proposedWeekShape', () => {
  it('renders the proposed week as the same day grid get_active_plan prints', () => {
    const line = proposedWeekShape([
      act('Easy run', 'FREQ=WEEKLY;BYDAY=TU,TH', '07:00'),
      act('Mobility', 'FREQ=WEEKLY;BYDAY=TU', '20:00'),
      act('Sit', 'FREQ=DAILY', '08:00'),
    ]);
    expect(line).toBe('Proposed week shape (their own items per day): Mo 1 · Tu 3 · We 1 · Th 2 · Fr 1 · Sa 1 · Su 1');
  });

  it('counts only THEIR items — a system row never pads the grid', () => {
    const line = proposedWeekShape([
      act('Easy run', 'FREQ=WEEKLY;BYDAY=WE', '07:00'),
      act('Weekly check-in', 'FREQ=WEEKLY;BYDAY=WE', undefined, 'system'),
    ]);
    expect(line).toBe('Proposed week shape (their own items per day): Mo — · Tu — · We 1 · Th — · Fr — · Sa — · Su —');
  });
});

describe('timeCollisions', () => {
  /** The Wednesday case itself: two efforts proposed onto the same day at the same clock time. */
  it('names both titles and the day/time when two commitments share a slot', () => {
    const lines = timeCollisions([
      act('Hill intervals', 'FREQ=WEEKLY;BYDAY=WE', '07:00'),
      act('Easy run', 'FREQ=WEEKLY;BYDAY=MO,WE', '07:00'),
      act('Mobility', 'FREQ=WEEKLY;BYDAY=WE', '17:00'),
    ]);
    expect(lines).toEqual(['Time collision: "Hill intervals" and "Easy run" both land on Wed at 07:00.']);
  });

  it('reports every occupied slot, one line each, and all titles when three stack', () => {
    const lines = timeCollisions([
      act('Hill intervals', 'FREQ=WEEKLY;BYDAY=WE,FR', '07:00'),
      act('Easy run', 'FREQ=WEEKLY;BYDAY=WE,FR', '07:00'),
      act('Mobility', 'FREQ=WEEKLY;BYDAY=WE', '07:00'),
    ]);
    expect(lines).toEqual([
      'Time collision: "Hill intervals" and "Easy run" and "Mobility" all land on Wed at 07:00.',
      'Time collision: "Hill intervals" and "Easy run" both land on Fri at 07:00.',
    ]);
  });

  it('stays quiet when the same day holds different times, floats, or a system row', () => {
    expect(
      timeCollisions([
        act('Hill intervals', 'FREQ=WEEKLY;BYDAY=WE', '07:00'),
        act('Mobility', 'FREQ=WEEKLY;BYDAY=WE', '17:00'),
        // Untimed and "anytime" rows FLOAT — a clash that exists only if you squint would teach
        // her to ignore the real ones.
        act('Stretching', 'FREQ=WEEKLY;BYDAY=WE'),
        act('Box breathing', 'FREQ=WEEKLY;BYDAY=WE', 'anytime'),
        act('Weekly check-in', 'FREQ=WEEKLY;BYDAY=WE', '07:00', 'system'),
      ]),
    ).toEqual([]);
  });
});

describe('constraintChecklist', () => {
  /** Deliberately NOT semantic matching — the labels are handed to HER to check ("Wednesday -
   *  limit to one workout" carries its meaning in words no string rule reads, 2026-08-31). */
  it('says the plan-around labels back as a check-list', () => {
    expect(
      constraintChecklist([
        { label: 'Wednesdays: one workout, no afternoons', plan_around: true },
        { label: 'left knee — patellar tendinopathy', plan_around: true },
      ]),
    ).toEqual([
      'Their file says they work around: Wednesdays: one workout, no afternoons; left knee — patellar tendinopathy — check the proposed week against these.',
    ]);
  });

  it('leaves out what is not planned around, and says nothing when the file is clear', () => {
    expect(constraintChecklist([{ label: 'left knee — eased', plan_around: false }, { label: '  ' }])).toEqual([]);
    expect(constraintChecklist([])).toEqual([]);
    expect(constraintChecklist(undefined)).toEqual([]);
  });
});

describe('planEditEvidence', () => {
  it('assembles shape, then collisions, then the check-list — and never blocks anything', () => {
    const lines = planEditEvidence(
      [act('Hill intervals', 'FREQ=WEEKLY;BYDAY=WE', '07:00'), act('Easy run', 'FREQ=WEEKLY;BYDAY=WE', '07:00')],
      [{ label: 'Wednesdays: one workout', plan_around: true }],
    );
    expect(lines).toEqual([
      'Proposed week shape (their own items per day): Mo — · Tu — · We 2 · Th — · Fr — · Sa — · Su —',
      'Time collision: "Hill intervals" and "Easy run" both land on Wed at 07:00.',
      'Their file says they work around: Wednesdays: one workout — check the proposed week against these.',
    ]);
  });

  it('is just the shape line on a clean week with nothing on file', () => {
    const lines = planEditEvidence([act('Easy run', 'FREQ=WEEKLY;BYDAY=TU', '07:00')], undefined);
    expect(lines).toEqual([
      'Proposed week shape (their own items per day): Mo — · Tu 1 · We — · Th — · Fr — · Sa — · Su —',
    ]);
  });
});
