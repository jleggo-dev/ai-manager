import type { Goal } from '@cadence/shared';

/**
 * Pure, dependency-free goal matching for plan synthesis (no DB/engine imports) so it's
 * unit-testable in isolation, like capture-normalize.ts.
 */

const normGoalTitle = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * Map a synthesized activity's stated goal_title back to the confirmed goal it serves. The Coach
 * echoes a title from <confirmed_goals> (models are unreliable at copying UUIDs), so we match on
 * the normalized title — EXACT first, then a UNIQUE containment match (tolerates a slight reword,
 * but never links when it would be ambiguous). Returns the canonical goal so the commitment points
 * at a real objective; unlinked/foundational/system activities (no goal_title, no match, or an
 * ambiguous one) return undefined and simply aren't grouped.
 */
export type GoalRef = Pick<Goal, 'goal_id' | 'title'>;

export function matchGoal(goalTitle: string | undefined, goals: GoalRef[]): GoalRef | undefined {
  const t = normGoalTitle(goalTitle ?? '');
  if (!t) return undefined;
  const exact = goals.find((g) => normGoalTitle(g.title) === t);
  if (exact) return { goal_id: exact.goal_id, title: exact.title };
  const near = goals.filter((g) => {
    const gt = normGoalTitle(g.title);
    return gt.length > 0 && (gt.includes(t) || t.includes(gt));
  });
  return near.length === 1 ? { goal_id: near[0]!.goal_id, title: near[0]!.title } : undefined;
}

/**
 * Words that say nothing about WHICH goal an activity serves — the shape of a session, a day, a
 * verb every goal shares. Anything left after these is a distinctive word ("piano", "spartan").
 */
const GENERIC_WORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'of',
  'for',
  'to',
  'in',
  'on',
  'at',
  'with',
  'my',
  'your',
  'this',
  'that',
  'practice',
  'session',
  'sessions',
  'training',
  'workout',
  'work',
  'drill',
  'drills',
  'routine',
  'build',
  'building',
  'improve',
  'get',
  'better',
  'more',
  'less',
  'up',
  'down',
  'time',
  'minutes',
  'min',
  'daily',
  'weekly',
  'morning',
  'evening',
  'night',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
  'easy',
  'long',
  'short',
  'steady',
  'light',
  'hard',
  'quick',
  'full',
  'rest',
]);

const distinctiveWords = (s: string): Set<string> =>
  new Set(
    normGoalTitle(s)
      .split(' ')
      .filter((w) => w.length >= 3 && !GENERIC_WORDS.has(w)),
  );

/**
 * The goal an activity serves: the title the Coach stated first (matchGoal), and when that is
 * missing or matches nothing, the activity's OWN title — linked only when exactly one goal shares
 * a distinctive word with it. "Sunday piano practice" links to "Practice piano" through "piano";
 * "Box breathing practice" shares nothing with it but "practice", which every drill has, and stays
 * unlinked; "Easy run" against two running goals is ambiguous and stays unlinked.
 *
 * Why (2026-10-28): the link is what tells the trail the activity's area, and area is what lets a
 * practice session offer a metronome. The owner's piano activity came through a replan with a
 * goal_title that matched nothing, so it had no area and the walkthrough never offered one. The
 * stated title still wins whenever it matches; this only answers when the Coach's tag failed.
 */
export function matchGoalForActivity(
  goalTitle: string | undefined,
  activityTitle: string | undefined,
  goals: GoalRef[],
): GoalRef | undefined {
  const stated = matchGoal(goalTitle, goals);
  if (stated) return stated;
  const words = distinctiveWords(activityTitle ?? '');
  if (words.size === 0) return undefined;
  const sharing = goals.filter((g) => {
    const gw = distinctiveWords(g.title);
    for (const w of words) if (gw.has(w)) return true;
    return false;
  });
  return sharing.length === 1 ? { goal_id: sharing[0]!.goal_id, title: sharing[0]!.title } : undefined;
}
