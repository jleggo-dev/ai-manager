/**
 * Every source at once, reported back to the Coach — the waterfall turned inside out.
 *
 * WHAT CHANGED AND WHY. `food-pricing.ts` walks ledger → USDA → FatSecret → research and stops at
 * the first rung whose answer clears a threshold. That makes the sources *fallbacks*: a second
 * opinion is not merely unused, it is never fetched, so nothing in the system has ever held two
 * nutrition records for the same food and asked which one is right. The owner's ruling
 * (2026-08-23) is that the deciding is the Coach's: *"She can and should compare all sources… a
 * good LLM can make the best determination."*
 *
 * So this queries them in PARALLEL and returns everything, disagreements included. It decides
 * nothing. It does not rank, does not drop a thin row, does not pick a winner — `findDisagreements`
 * only points at where the answers diverge, which is a fact about the data rather than a judgement
 * about it.
 *
 * SHE CALLS IT, AND SHE CAN CALL PAST IT. Owner: *"I think she can call the fan out or each
 * individual call."* The fan-out is one tool; the rungs stay individually reachable so a second
 * look at one source costs one call rather than four.
 *
 * COST DISCIPLINE IS IN WHAT IS PUSHED VS PULLED. The free rungs (the local ledger, which holds the
 * CNF corpus, and USDA, which is free after first use) run on every fan-out. The billed and the
 * slow ones do not: FatSecret bills per reprice and the web rung costs seconds of a person's
 * attention, so they are hers to spend deliberately — `research_food` is its own tool, and
 * FatSecret runs here only when asked for. Cheap sources pushed, expensive sources pulled.
 *
 * EVERY STEP IS REPORTED HONESTLY. `sources_checked` records what actually ran, with timings and
 * with skips named — it is what the visible trace renders from, and the owner's requirement is that
 * the trace be real: *"I don't want the copy to be decorative… It has to be true."* A source that
 * was skipped says so rather than quietly not appearing.
 */
import { searchFoods } from '../repos/foods.ts';
import { enrichFoodsWithUsda } from './food-sources/usda-enrich.ts';
import { findFatSecretMatch } from './food-sources/fatsecret-enrich.ts';
import { isGenericWholeFoodQuery } from './food-sources/usda-gate.ts';
import { isUsdaConfigured } from './food-sources/usda.ts';
import { findDisagreements, toCandidate, type FoodSourceName, type SourceCandidate } from './food-source-report.ts';
import type { Food } from '@cadence/shared';

/** Status of one rung on one fan-out. `skipped` is a real answer and must never read as `miss`. */
export type SourceStatus = 'hit' | 'miss' | 'skipped' | 'error';

export interface SourceCheck {
  source: FoodSourceName;
  status: SourceStatus;
  /** Wall-clock for this rung. The trace shows it; a 12 ms ledger hit should look instant. */
  ms: number;
  /** Why it skipped, what it found, or what broke — always something a person could read. */
  detail: string;
}

export interface FanOutInput {
  query: string;
  brand?: string | null;
  /** "1 cup", "2 tbsp" — what the candidates get priced at when a source offers it. */
  measure?: string | null;
  /** FatSecret bills per call, so it is opt-in: she asks for it after reading the free rungs. */
  includeFatSecret?: boolean;
}

export interface FanOutResult {
  query: string;
  brand: string | null;
  requested_measure: string | null;
  candidates: SourceCandidate[];
  sources_checked: SourceCheck[];
  disagreements: string[];
}

const LOCAL_LIMIT = 8;
/** Per-rung ceiling. One slow source must not hold the whole fan-out. */
const RUNG_TIMEOUT_MS = 20_000;

async function timed<T>(
  source: FoodSourceName,
  run: () => Promise<T>,
): Promise<{ value: T | null; check: SourceCheck }> {
  const started = Date.now();
  try {
    const value = await Promise.race([
      run(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timed out')), RUNG_TIMEOUT_MS)),
    ]);
    return { value, check: { source, status: 'hit', ms: Date.now() - started, detail: '' } };
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.warn(`[food-fanout] ${source} failed:`, detail);
    return { value: null, check: { source, status: 'error', ms: Date.now() - started, detail } };
  }
}

/** The user's own foods plus everything shared, including the CNF corpus. Free, and always first. */
async function ledgerRung(userId: string, query: string): Promise<{ foods: Food[]; check: SourceCheck }> {
  const { value, check } = await timed('ledger', () => searchFoods(userId, query, LOCAL_LIMIT));
  const foods = value ?? [];
  if (check.status === 'error') return { foods, check };
  return {
    foods,
    check: {
      ...check,
      status: foods.length ? 'hit' : 'miss',
      detail: foods.length ? `${foods.length} already on file` : 'nothing on file yet',
    },
  };
}

/**
 * USDA, free after first use. `enrichFoodsWithUsda` imports what it finds, so a hit here also
 * becomes a ledger hit forever after — the deterministic rung gets faster the more this runs.
 *
 * It takes the local list to decide whether to bother, and returns local+imported merged, so the
 * imported rows are whatever is new.
 */
async function usdaRung(
  userId: string,
  query: string,
  local: Food[],
  brand: string | null,
): Promise<{ foods: Food[]; check: SourceCheck }> {
  if (!isGenericWholeFoodQuery(query)) {
    return {
      foods: [],
      check: { source: 'usda', status: 'skipped', ms: 0, detail: 'query is a barcode or too long for a food search' },
    };
  }

  /**
   * An unconfigured USDA is a SKIP, not a MISS, and the difference is the whole point of the trace.
   *
   * `enrichFoodsWithUsda` returns the local list unchanged when there is no API key, so diffing it
   * found nothing new and this reported "no new match" — the trace saying USDA had been consulted
   * and had nothing, when USDA was never called at all. That is precisely the decorative copy the
   * header of this file forbids, written three screens below the rule.
   */
  if (!isUsdaConfigured()) {
    return {
      foods: [],
      check: { source: 'usda', status: 'skipped', ms: 0, detail: 'not configured here (no USDA_API_KEY)' },
    };
  }

  const knownIds = new Set(local.map((f) => f.food_id));
  const { value, check } = await timed('usda', () => enrichFoodsWithUsda(userId, query, local, { brand }));
  if (check.status === 'error') return { foods: [], check };

  const fresh = (value ?? []).filter((f) => !knownIds.has(f.food_id));
  return {
    foods: fresh,
    check: {
      ...check,
      status: fresh.length ? 'hit' : 'miss',
      detail: fresh.length ? `${fresh.length} imported` : 'no new match (the ledger may already hold it)',
    },
  };
}

/** Billed per reprice, so opt-in. Skipping says so out loud rather than silently not appearing. */
async function fatSecretRung(
  query: string,
  brand: string | null,
  include: boolean,
): Promise<{ foods: Food[]; check: SourceCheck }> {
  if (!include) {
    return {
      foods: [],
      check: { source: 'fatsecret', status: 'skipped', ms: 0, detail: 'not requested — billed per call' },
    };
  }
  const { value, check } = await timed('fatsecret', () => findFatSecretMatch(query, brand));
  if (check.status === 'error') return { foods: [], check };
  return {
    foods: value ? [value] : [],
    check: { ...check, status: value ? 'hit' : 'miss', detail: value ? value.name : 'no match' },
  };
}

/**
 * Ask every eligible source about one food and report what each said.
 *
 * Never throws: a rung that fails becomes an `error` row in `sources_checked` and the rest of the
 * fan-out stands. A lookup that returns no candidates is a real answer — the Coach's cue to spend
 * the web rung — and must be distinguishable from one that broke, which is what `status` is for.
 */
export async function fanOutFoodSources(userId: string, input: FanOutInput): Promise<FanOutResult> {
  const query = (input.query ?? '').trim();
  const brand = input.brand?.trim() || null;
  const measure = input.measure?.trim() || null;

  if (!query) {
    return { query: '', brand, requested_measure: measure, candidates: [], sources_checked: [], disagreements: [] };
  }

  // The ledger runs first because USDA needs its result to decide whether to bother — that is a
  // real data dependency, not a preference. FatSecret has none, so it runs alongside both.
  const [ledger, fatsecret] = await Promise.all([
    ledgerRung(userId, query),
    fatSecretRung(query, brand, input.includeFatSecret === true),
  ]);
  const usda = await usdaRung(userId, query, ledger.foods, brand);

  const candidates: SourceCandidate[] = [
    ...ledger.foods.map((f) => toCandidate(f, 'ledger', measure)),
    ...usda.foods.map((f) => toCandidate(f, 'usda', measure)),
    ...fatsecret.foods.map((f) => toCandidate(f, 'fatsecret', measure)),
  ];

  return {
    query,
    brand,
    requested_measure: measure,
    candidates,
    sources_checked: [ledger.check, usda.check, fatsecret.check],
    disagreements: findDisagreements(candidates),
  };
}
