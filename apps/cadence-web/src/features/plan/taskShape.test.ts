/**
 * Which sheet a Today tap opens, as a table.
 *
 * `taskOpener` is a router that reads nothing but the title, and a router like that fails
 * silently: the wrong sheet opens and no error is thrown anywhere. On 2026-09-01 the owner tapped
 * "Weighted hill intervals (vest or sandbag) + grip finisher" and got the scale sheet, because the
 * weigh-in rule was `/weigh/i`. There was no test that tapped a workout, so nothing caught it.
 *
 * This is the "tap every button" test for the trail: one row per shape the planner actually
 * produces, positives AND near-misses. A new title pattern that could be mistaken for another
 * shape gets a row here before it ships — the routing is deterministic, so the table is cheap
 * and the bug it prevents opens the wrong sheet on device.
 */
import { describe, it, expect } from 'vitest';
import { taskOpener, type TaskOpener } from './taskShape.ts';
import type { PlanOccurrence } from '../../lib/api.ts';

const occ = (title: string, kind: PlanOccurrence['kind'] = 'user'): PlanOccurrence => ({
  occurrence_id: 'o1',
  activity_id: 'a1',
  title,
  kind,
  status: 'pending',
});

const TABLE: Array<[title: string, opens: TaskOpener]> = [
  // Captures — a single number or a plate.
  ['Weekly weigh-in', 'weigh'],
  ['Weigh in', 'weigh'],
  ['Log breakfast', 'meal'],
  ['Log dinner', 'meal'],
  ['Food log', 'meal'],
  // Menu-derived chores.
  ['Pick up 6 things', 'shop'],
  ['The shop', 'shop'],
  ['Cook chana masala', 'cook'],
  // Sessions — everything the coach programmes, including every title that merely CONTAINS a
  // capture word. These are the rows the bug lived in.
  ['Weighted hill intervals (vest or sandbag) + grip finisher', 'task'],
  ['Weighted vest walk', 'task'],
  ['Weights', 'task'],
  ['Body weight squats', 'task'],
  ['Morning joint mobility & prehab', 'task'],
  ['Easy run', 'task'],
  ['Box breathing practice', 'task'],
];

describe('taskOpener', () => {
  it.each(TABLE)('"%s" opens the %s sheet', (title, opens) => {
    expect(taskOpener(occ(title))).toBe(opens);
  });
});
