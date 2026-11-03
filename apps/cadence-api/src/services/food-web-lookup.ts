/**
 * The web rung inside a described read — in the second round only, for a lookup the food-check
 * asked for with the maker named (owner ruling 2026-11-03, FOOD-LOGGING-COACH-LED.md).
 *
 * Why only there. "Rickard's Red" has no record anywhere but a chain's menu row ("Perkins
 * Restaurant Rickard's Red Beer"); the only way to a plain "Rickard's Red Beer, 1 pint" is the
 * web-grounded `research-food` job (food-research.ts), measured 7–90 s a part. That is seconds of
 * the person's attention, so it never runs on the first fill: the free sources answer first, and
 * only when the model has read them, found a chain's rows or none for a maker-named food, and
 * asked for one more lookup with that maker as its brand, does the lookup go to the web as well
 * (food-check.ts decides which lookups; this file is what the web answers). The maker is the
 * trigger because it is what the web needs: the live probe of 2026-11-03 found Rickard's Red in
 * 9 s with the brand given and refused without it.
 *
 * What comes back is kept. A researched row is pinned as this person's private food before it is
 * shown, for two reasons: only a stored record can be picked (food-candidate-book.ts), and the
 * point of paying for the lookup is that the ledger answers these words for free next time (A23).
 * A preview walked away from therefore leaves one private food behind — as a USDA import does,
 * and unlike the meal itself, which leaves nothing. A food of theirs that already matches is
 * reused, never overwritten.
 *
 * Bounded, and honest about it. Each web lookup waits WEB_IN_READ_MS; past that the trace says
 * the web did not answer in time, and the answer, if it comes, is still pinned so the next read
 * finds it on file. A fault never reads as empty: the check says found, nothing (with the job's
 * own reason), or failed (with what broke).
 */
import type { Food } from '@cadence/shared';
import { insertFood } from '../repos/foods.ts';
import { cutAtWord } from './food-candidate-book.ts';
import type { WebLookupFn, WebRows } from './food-check.ts';
import { findOwnDuplicate } from './food-pricing.ts';
import { researchFoodOutcome, type ResearchOutcome, type ResearchedFood } from './food-research.ts';
import type { SourceCheck } from './food-source-fanout.ts';
import { toCandidate } from './food-source-report.ts';

/** How long one web lookup may hold the read. The job's own ceiling is longer (food-research.ts); a late answer is still kept. */
export const WEB_IN_READ_MS = 60_000;
/** The most of a reason the trace carries. */
const REASON_MAX = 140;

export interface PinDeps {
  findOwnDuplicate: typeof findOwnDuplicate;
  insertFood: typeof insertFood;
}

/**
 * Keep a researched food as this person's private food, so it can be picked now and found on file
 * next time. One of theirs that already matches by name is reused as it is. Null when the pin
 * failed — the caller says so; the row is then not offered, since it could not be logged.
 */
export async function pinResearchedFood(
  userId: string,
  found: ResearchedFood,
  deps: PinDeps = { findOwnDuplicate, insertFood },
): Promise<Food | null> {
  const { food } = found;
  try {
    const dupe = await deps.findOwnDuplicate(userId, food.name, food.brand);
    if (dupe) return dupe;
    return await deps.insertFood(userId, {
      name: food.name,
      brand: food.brand,
      source: 'research',
      visibility: 'private',
      base_unit: food.base_unit,
      macros_per_base: food.macros_per_base ?? {},
      servings: food.servings,
      default_serving: food.default_serving,
      confidence: food.confidence,
    });
  } catch (e) {
    console.warn('[food-web-lookup] could not keep the researched food on file:', e);
    return null;
  }
}

export interface WebLookupDeps {
  research: (userId: string, item: { name: string; brand?: string | null }) => Promise<ResearchOutcome>;
  pin: (userId: string, found: ResearchedFood) => Promise<Food | null>;
  boundMs: number;
}

const label = (f: Pick<Food, 'name' | 'brand'>): string => `${f.name}${f.brand ? ` (${f.brand})` : ''}`;
/** What the web was asked, as the research job joins it: the maker, then the food. */
const webWords = (l: { q: string; brand: string | null }): string => [l.brand, l.q].filter(Boolean).join(' — ');

/** The web for one lookup: never throws, always a check that says what happened. */
export function webLookup(
  userId: string,
  deps: WebLookupDeps = { research: researchFoodOutcome, pin: pinResearchedFood, boundMs: WEB_IN_READ_MS },
): WebLookupFn {
  return async (lookup): Promise<WebRows> => {
    const started = Date.now();
    const check = (status: SourceCheck['status'], detail: string): SourceCheck => ({
      source: 'research',
      status,
      ms: Date.now() - started,
      detail,
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const asked = deps.research(userId, { name: lookup.q, brand: lookup.brand });
    const late = new Promise<'late'>((resolve) => {
      timer = setTimeout(() => resolve('late'), deps.boundMs);
    });
    try {
      const outcome = await Promise.race([asked, late]);
      if (outcome === 'late') {
        // The answer, if it comes, is still kept: the next read finds it on file for free.
        void asked.then((o) => (o.result ? deps.pin(userId, o.result) : null)).catch(() => null);
        return {
          rows: [],
          check: check('error', `no answer within ${Math.round(deps.boundMs / 1000)} s; kept on file if it comes back`),
        };
      }
      if (!outcome.result) {
        return { rows: [], check: check('miss', cutAtWord(outcome.reason ?? 'nothing found', REASON_MAX)) };
      }
      const pinned = await deps.pin(userId, outcome.result);
      const name = label(outcome.result.food);
      if (!pinned) {
        return {
          rows: [],
          check: check('error', `found "${name}" but could not keep it on file, so it cannot be picked`),
        };
      }
      // The row says where it came from: the web, asked with these words. Identical numbers beside
      // a restaurant's row of the same beer gave the model nothing to tell them apart by (eval,
      // 2026-11-03). It does not claim "the maker's own": the web answers with whatever brand the
      // page named, a restaurant's included, and the row's own brand is there to read.
      const row = toCandidate(pinned, 'research', lookup.measure);
      return {
        rows: [{ ...row, notes: [...row.notes, `found on the web for "${webWords(lookup)}"`] }],
        check: check('hit', `found "${label(pinned)}", kept as your private food`),
      };
    } catch (e) {
      return { rows: [], check: check('error', cutAtWord(e instanceof Error ? e.message : String(e), REASON_MAX)) };
    } finally {
      clearTimeout(timer);
    }
  };
}
