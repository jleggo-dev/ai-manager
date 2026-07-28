import { isFoodTitle, isWeighTitle } from '../../components/occurrence-mod.ts';
import type { PlanOccurrence } from '../../lib/api.ts';

/**
 * How a Today task opens (REQ8 task shapes). A **capture** is a single data entry — a weigh-in, a
 * meal — so it opens a minimal sheet: no walkthrough, no "start", no time-flex. A **task** is a
 * coach-programmed session; the task sheet then decides single-step (one tool, inline) vs multi-step
 * (the walkthrough) once the session loads. Derived here in ONE place from the coach's system task
 * (title today; an explicit tool tag next) instead of the title checks that were scattered around.
 */
export type TaskOpener = 'weigh' | 'meal' | 'task';

export function taskOpener(occ: PlanOccurrence): TaskOpener {
  if (isWeighTitle(occ.title)) return 'weigh';
  if (isFoodTitle(occ.title)) return 'meal';
  return 'task';
}
