/**
 * Confirm-first draft for Food tab logging (Req 5 WS4).
 * A draft is never written until the user taps confirm.
 */
import type { Food } from '@cadence/shared';
import type { FoodCandidate } from '../../lib/api.ts';

/** Optional resolver portion prefill (serving index + inferred qty). */
export interface FoodDraftPortion {
  servingIndex?: number;
  quantity?: number;
}

/** Unsaved capture → createFood on confirm; saved food → log only. */
export type FoodDraft =
  | ({ kind: 'candidate'; candidate: FoodCandidate } & FoodDraftPortion)
  | ({ kind: 'saved'; food: Food } & FoodDraftPortion);

export function draftName(d: FoodDraft): string {
  return d.kind === 'candidate' ? d.candidate.name : d.food.name;
}

export function draftBrand(d: FoodDraft): string | null {
  return d.kind === 'candidate' ? d.candidate.brand : d.food.brand;
}
