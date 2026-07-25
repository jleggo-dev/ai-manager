/**
 * Req 5 §5.6 — Food Resolver (WS-R).
 *
 * WS1 ships the interface + a thin search-backed stub so Food-tab / coach / recipes
 * can wire against a fixed contract. Full ranking (embeddings, dietary filter,
 * quantity/serving inference, recipe candidates) lands with WS-R.
 */
import type { Food } from '@cadence/shared';
import { listRecentFoods, searchFoods } from '../repos/foods.ts';
import { type ResolveCandidate, type ResolveInput } from './food-resolver-types.ts';

export type { ResolveCandidate, ResolveCandidateKind, ResolveInput } from './food-resolver-types.ts';
export { pickPreselected } from './food-resolver-types.ts';

function foodLabel(f: Food): string {
  return f.brand ? `${f.name} (${f.brand})` : f.name;
}

function foodCandidate(f: Food, score: number): ResolveCandidate {
  return {
    kind: 'food',
    score,
    label: foodLabel(f),
    food_id: f.food_id,
    brand: f.brand,
    preselected_serving: f.default_serving,
  };
}

/**
 * Stub resolver: recents when text is empty; name/brand search otherwise;
 * always appends a "new food" escape hatch when text is non-empty.
 */
export async function resolveCandidates(userId: string, input: ResolveInput): Promise<ResolveCandidate[]> {
  const text = typeof input.text === 'string' ? input.text.trim() : '';
  if (!text) {
    const recents = await listRecentFoods(userId, 10);
    return recents.map((f, i) => foodCandidate(f, 1 - i * 0.01));
  }

  const hits = await searchFoods(userId, text, 10);
  const candidates = hits.map((f, i) => foodCandidate(f, 1 - i * 0.05));
  candidates.push({
    kind: 'new',
    score: 0,
    label: `Add "${text}" as a new food`,
  });
  return candidates;
}
