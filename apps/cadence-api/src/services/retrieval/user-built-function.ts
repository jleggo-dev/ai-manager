import type { OccurrenceSession } from '@cadence/shared';
import type { RetrievalFunction } from './types.ts';
import { listUserRoutines, type UserRoutineView } from '../user-routines.ts';

/**
 * `get_user_built_activities` — the activities the USER built in the Activity Builder (wave 3),
 * with the standing rule attached (owner ruling 2026-09-01): the coach is INFORMED of what they
 * built — she never approves it, never rewrites its steps, and treats "can you review it?" as an
 * ordinary ask she answers from the steps listed here.
 *
 * Rides the `ongoing` selection (context-pack.ts) rather than the tool drawer: awareness is the
 * whole point — a coach who has to be TOLD the user built something is the same failure as the
 * workouts her own tools recorded. Cost control is the render contract, not the selection: '' when
 * nothing is built, so the overwhelming default user pays nothing.
 */

/** Step names from the built session, capped so one elaborate routine can't flood the pack. */
function stepNames(session: OccurrenceSession, cap = 8): string {
  const names: string[] = [];
  for (const block of session.blocks ?? []) {
    for (const item of block.items ?? []) {
      if (item.name) names.push(item.name);
    }
  }
  if (names.length === 0) return 'no steps';
  const shown = names.slice(0, cap).join(', ');
  return names.length > cap ? `${shown}, +${names.length - cap} more` : shown;
}

/** Real minutes only — sums the steps' own durations; '' when none carries one. */
function totalMin(session: OccurrenceSession): string {
  let min = 0;
  for (const block of session.blocks ?? []) {
    for (const item of block.items ?? []) {
      if (typeof item.duration_min === 'number' && item.duration_min > 0) min += item.duration_min;
    }
  }
  return min > 0 ? `; ~${Math.round(min)} min` : '';
}

function routineLine(r: UserRoutineView): string {
  const area = r.area ? ` (${r.area})` : '';
  const runs =
    r.runs > 0
      ? `run ${r.runs} time${r.runs === 1 ? '' : 's'}${r.last_run ? `, last ${r.last_run}` : ''}`
      : 'never run';
  const sched = r.schedule
    ? `on the plan ${r.schedule.days.join(', ')}${r.schedule.time_of_day ? ` (${r.schedule.time_of_day})` : ''}`
    : 'not scheduled';
  return `- "${r.name}"${area} — steps: ${stepNames(r.session)}${totalMin(r.session)}; ${runs}; ${sched}.`;
}

const MAX_LINES = 12;

export const GET_USER_BUILT_ACTIVITIES: RetrievalFunction = {
  name: 'get_user_built_activities',
  description:
    'Activities the user built themselves in the Activity Builder — each with its name, area, step list, total minutes, run count, and whether it is on the plan. Use to know what they have built without being told, to schedule around their own activities, and to answer a request to review one (read its steps here and give a plain read). Their steps are theirs: never rewrite them; propose any change as a question.',
  domains: ['plan', 'goals'],
  async run(userId) {
    return listUserRoutines(userId);
  },
  render(result) {
    const routines = result as UserRoutineView[];
    if (!routines || routines.length === 0) return '';
    const lines = routines.slice(0, MAX_LINES).map(routineLine);
    if (routines.length > MAX_LINES)
      lines.push(`- +${routines.length - MAX_LINES} more in Settings › Your activities.`);
    return [
      'Activities the user built themselves (Activity Builder):',
      ...lines,
      'These are the user’s own: never rewrite their steps — propose changes as questions. You may schedule them and plan around them. If asked to review one, read its steps above and answer plainly.',
    ].join('\n');
  },
  rows(result) {
    return ((result as UserRoutineView[]) ?? []).length;
  },
};
