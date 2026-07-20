import type { PlanOccurrence } from '../lib/api.ts';

export const isFoodTitle = (t: string) => /food|meal|nutrition/i.test(t);
export const isWeighTitle = (t: string) => /weigh/i.test(t);

export type OccMod = 'nutrition' | 'weigh' | 'session';

export function occMod(o: PlanOccurrence): OccMod {
  if (isFoodTitle(o.title)) return 'nutrition';
  if (isWeighTitle(o.title)) return 'weigh';
  return 'session';
}

/** User rows + weigh-in / food-log system rows open a capture/session sheet. */
export function isOccurrenceOpenable(o: PlanOccurrence): boolean {
  return o.kind === 'user' || isFoodTitle(o.title) || isWeighTitle(o.title);
}
