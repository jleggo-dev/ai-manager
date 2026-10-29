/**
 * Goal linking is a router — it decides which objective an activity's progress attaches to and
 * which area (and so which tools) its sessions get — and routers fail silently. Positives AND
 * near-misses: a shared generic word is not a link, two candidates is no link.
 */
import { describe, expect, it } from 'vitest';
import { matchGoal, matchGoalForActivity, type GoalRef } from './plan-match.ts';

const goals: GoalRef[] = [
  { goal_id: 'g-piano', title: 'Practice piano' },
  { goal_id: 'g-mind', title: 'Build mental resilience' },
  { goal_id: 'g-spartan', title: 'Run a Spartan Ultra Beast' },
];
const twoRuns: GoalRef[] = [...goals, { goal_id: 'g-10k', title: 'Run a 10k in October' }];

describe('matchGoalForActivity', () => {
  it.each<[string, string | undefined, string, GoalRef[], string | undefined]>([
    ['the stated title wins when it matches', 'Practice piano', 'Sunday piano practice', goals, 'g-piano'],
    [
      'a stated title that matches nothing falls back to the activity title',
      'Keep up the piano',
      'Sunday piano practice',
      goals,
      'g-piano',
    ],
    [
      'no stated title: the activity title links through its distinctive word',
      undefined,
      'Sunday piano practice',
      goals,
      'g-piano',
    ],
    ['"practice" alone is not a link (every drill has it)', undefined, 'Box breathing practice', goals, undefined],
    ['a session word links to the one goal that shares it', undefined, 'Spartan obstacle strength', goals, 'g-spartan'],
    ['two goals sharing the word is ambiguous — no link', undefined, 'Easy run', twoRuns, undefined],
    ['one running goal: "Easy run" links through "run"', undefined, 'Easy run', goals, 'g-spartan'],
    ['generic words only — no link', undefined, 'Morning session', goals, undefined],
    ['an empty title — no link', undefined, '', goals, undefined],
    ['punctuation and case do not matter', undefined, 'PIANO: scales & arpeggios', goals, 'g-piano'],
    [
      'the stated title still wins over a title that would link elsewhere',
      'Build mental resilience',
      'Piano as meditation',
      goals,
      'g-mind',
    ],
  ])('%s', (_label, stated, activity, gs, want) => {
    expect(matchGoalForActivity(stated, activity, gs)?.goal_id).toBe(want);
  });
});

describe('matchGoal keeps its contract', () => {
  it('exact, then unique containment, never ambiguous', () => {
    expect(matchGoal('practice PIANO', goals)?.goal_id).toBe('g-piano');
    expect(matchGoal('Run a Spartan Ultra Beast this year', goals)?.goal_id).toBe('g-spartan');
    expect(matchGoal('Run', twoRuns)).toBeUndefined();
    expect(matchGoal(undefined, goals)).toBeUndefined();
  });
});
