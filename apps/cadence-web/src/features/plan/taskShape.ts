import { isFoodTitle, isWeighTitle } from '../../components/occurrence-mod.ts';
import type { PlanOccurrence } from '../../lib/api.ts';

/**
 * How a Today task opens (REQ8 task shapes). A **capture** is a single data entry — a weigh-in, a
 * meal — so it opens a minimal sheet: no walkthrough, no "start", no time-flex. **shop** / **cook**
 * are the menu-derived food tasks (design E/2G): shop opens the aisle checklist, cook the recipe
 * walkthrough. A **task** is a coach-programmed session; the task sheet then decides single-step vs
 * multi-step (the walkthrough) once the session loads. Derived here in ONE place from the title.
 */
export type TaskOpener = 'weigh' | 'meal' | 'shop' | 'cook' | 'task';

/** Menu-derived shop task — "Pick up N things" / "The shop". */
export const isShopTitle = (title: string): boolean => /\bpick up\b|\bthe shop\b|shopping/i.test(title);
/** Menu-derived cook task — "Cook {dish}". */
export const isCookTitle = (title: string): boolean => /^\s*cook\b/i.test(title);

export function taskOpener(occ: PlanOccurrence): TaskOpener {
  if (isWeighTitle(occ.title)) return 'weigh';
  if (isShopTitle(occ.title)) return 'shop';
  if (isCookTitle(occ.title)) return 'cook';
  if (isFoodTitle(occ.title)) return 'meal';
  return 'task';
}
