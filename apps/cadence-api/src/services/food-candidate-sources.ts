/**
 * The lookup behind the candidate book in production: the fan-out's free rungs (the ledger with
 * the CNF corpus, USDA) plus FatSecret's top rows, each fetched in full so the book shows every
 * latte with its own numbers and not the one row a lexical score ranked first (#426).
 *
 * FatSecret bills per fetch, and `fanOutFoodSources` keeps it opt-in for the coach's own tool.
 * Here it is always asked, because the described-meal path is exactly the case the owner ruled
 * on (2026-10-29): the choosing is the model's, and it can only choose from what it is shown.
 * `FATSECRET_ROWS` is what the eval paid for (run 2); ruling 6 in FOOD-LOGGING-COACH-LED.md —
 * fetch all N up front, or names first and the pick only — is still the owner's to make, and
 * this constant is where it lands. A row already fresh in the ledger costs no fetch.
 *
 * The trace stays true: the fan-out reports FatSecret as "skipped — not requested", which would
 * be a lie once the rows are fetched here, so its line is replaced with what actually happened.
 */
import { fanOutFoodSources, type SourceCheck } from './food-source-fanout.ts';
import { toCandidate, type SourceCandidate } from './food-source-report.ts';
import { isFatSecretConfigured, searchFatSecretFoods } from './food-sources/fatsecret.ts';
import { refreshFatSecretFood } from './food-sources/fatsecret-enrich.ts';
import { withFatSecretRows, type BookLookup, type BookLookupFn } from './food-candidate-book.ts';

/** FatSecret rows per lookup, each a billed fetch unless the ledger already holds it fresh. */
export const FATSECRET_ROWS = 5;

async function fatSecretTopRows(lookup: BookLookup): Promise<{ rows: SourceCandidate[]; check: SourceCheck }> {
  const started = Date.now();
  if (!isFatSecretConfigured()) {
    return { rows: [], check: { source: 'fatsecret', status: 'skipped', ms: 0, detail: 'not set up on this server' } };
  }
  try {
    const hits = await searchFatSecretFoods([lookup.brand, lookup.q].filter(Boolean).join(' '), FATSECRET_ROWS);
    const foods = await Promise.all(hits.map((h) => refreshFatSecretFood(h.food_id).catch(() => null)));
    const rows = foods.flatMap((f) => (f ? [toCandidate(f, 'fatsecret', lookup.measure)] : []));
    return {
      rows,
      check: {
        source: 'fatsecret',
        status: rows.length ? 'hit' : 'miss',
        ms: Date.now() - started,
        detail: rows.length ? `${rows.length} rows` : 'no match',
      },
    };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.warn('[food-candidate-sources] fatsecret failed:', detail);
    return { rows: [], check: { source: 'fatsecret', status: 'error', ms: Date.now() - started, detail } };
  }
}

/** Every source at once for one part of a meal, FatSecret's top rows included. Never throws. */
export function wideLookup(userId: string): BookLookupFn {
  return async (lookup) => {
    const [base, fatsecret] = await Promise.all([
      fanOutFoodSources(userId, { query: lookup.q, brand: lookup.brand, measure: lookup.measure }),
      fatSecretTopRows(lookup),
    ]);
    const merged = withFatSecretRows(base, fatsecret.rows);
    return {
      ...merged,
      sources_checked: [...base.sources_checked.filter((c) => c.source !== 'fatsecret'), fatsecret.check],
    };
  };
}
