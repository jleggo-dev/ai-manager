import type { Food, FoodBaseUnit, FoodNutrients, FoodServing } from '@cadence/shared';
import { runJobBySlug } from '../ai/aim.ts';
import { logAi } from './ai-log.ts';
import { normalizeFood, describeNormalizationProblems } from './food-sources/normalized.ts';
import { nutritionTier } from './food-sources/completeness.ts';

/**
 * The web-grounded rung — `research-food` — for a VENDOR-NAMED food nothing deterministic matched.
 *
 * Owner's call (2026-08-23): "we can build a processing job in AI Admin within devs.ai and just
 * turn on web-search for it." So this is a processing job like every other AI call in the app
 * (auditable, never an app-built prompt), on a dedicated profile with `web_search` enabled.
 *
 * What makes an UNSTABLE source acceptable here is A23: the lookup runs once, the answer is
 * pinned, and the same words resolve to the same row forever after. Web search's variance is a
 * problem for a source you re-ask and a non-problem for a source you ask once. That is also why
 * the gate must hold — this is the most expensive rung (seconds of a person's attention), so it
 * fires only when a vendor was actually named and only when the ledger, USDA and FatSecret all
 * came up empty.
 *
 * WHERE THE LATENCY LIVES. Research runs at PREVIEW (pin:false), not at log — the card must show
 * the numbers the user is confirming, and numbers that change after a confirm would break
 * confirm-first. The `est.source === 'research'` marker rides the card back to the log call so
 * the question is never asked twice.
 *
 * The bar is higher than for cached sources: `nutritionTier` must reach 'macros' (kcal + all
 * four). A grounded lookup that could not find the macro split does not beat `estimate-food`,
 * and the item falls through to that existing path. Micros are accepted only as the label states
 * them — the job is instructed never to invent them, and provenance stays honest ('label').
 */
export interface ResearchedFood {
  /** A transient row — NOT inserted; pinItem persists it (with real servings) when the log commits. */
  food: Food;
  source_url: string | null;
  /**
   * Other product names the lookup weighed and did not pick, when several plausibly matched
   * (owner's principle, TOOL-HARNESS.md: "code must not pre-filter to one winner"). Empty when
   * only one product plausibly matched — never padded to look thorough.
   */
  alternates: string[];
}

/**
 * Every way this rung can end without a usable food, in words instead of a bare `null` (MP35).
 *
 * Ten separate `return null`s used to live below this line, and the type system flattened every
 * one of them into the same signal: nothing. That is a lie by omission for most of them. A
 * low-confidence hit, a missing name, a thin macro split, two views disagreeing by arithmetic, a
 * record the normalization guard would not pass — each of those means something WAS found and was
 * turned away, which is a different fact from "there was nothing to find," which is itself a
 * different fact from "the lookup broke before it answered." A `console.warn` and an `ai_log` row
 * do not tell the Coach either — only text riding the return value does, because only the return
 * value reaches whoever called this.
 *
 * Collapsing those three facts into one is exactly the mistake `tool-response.ts` guards against
 * for tool text ("an error must never look like an empty result"); this is the same discipline one
 * layer earlier, before there is any tool text to guard. The three buckets never share wording —
 * `food-research.test.ts` asserts it the same way `tool-response.test.ts` does for its pair:
 * "nothing" names an empty search, "refused" names something found and turned away, "broke" names
 * a fault in the asking.
 */
export interface ResearchOutcome {
  /** Set only when the rung produced something worth pinning. */
  result: ResearchedFood | null;
  /** Null exactly when `result` is set. Never blank when `result` is null. */
  reason: string | null;
}

/** Owner ruling 2026-08-23: LLM timeouts are MINUTES, not seconds — "they're unpredictable" and
 *  "they actually rarely just timeout". Measured spread that day: 7s (gpt-4.1) to >90s (a
 *  reasoning model deliberating with web_search). A tight race converts slow successes into
 *  nulls after paying for them anyway, so this errs long and lets the cooldown absorb repeats. */
const RESEARCH_TIMEOUT_MS = 240_000;

/**
 * A search that came back empty stays answered for a while.
 *
 * Without this, one unfindable product taxes the user TWICE — the preview searches (~70s), finds
 * nothing, the marker never sets (it only rides a success), and the log tap searches again. The
 * pin at log ends the story for good; this only has to bridge the minutes between first sight and
 * that pin, plus repeated previews of the same text.
 */
const RESEARCH_COOLDOWN_MS = 10 * 60 * 1000;
const recentMisses = new Map<string, number>();

export function __resetResearchCooldownForTests(): void {
  recentMisses.clear();
}
const MIN_CONFIDENCE = 0.4;
const BASE_UNITS: readonly FoodBaseUnit[] = ['g', 'ml', 'item'];

/** Only a vendor-named item earns the expensive rung, and only once — the marker survives the card. */
export function shouldResearchItem(item: { brand?: string | null; est?: { source?: string } | null }): boolean {
  const named = (item.brand ?? '').trim().length >= 2;
  return named && item.est?.source !== 'research' && item.est?.source !== 'user';
}

function firstJsonObject(raw: string): Record<string, unknown> | null {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(raw.slice(start, end + 1)) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

const MAX_ALTERNATES = 5;
const MAX_ALTERNATE_LEN = 80;

/**
 * The other names the lookup weighed and did not pick. Trimmed, capped, deduplicated, and never
 * including the name it actually returned — that would just be the pick repeating itself.
 */
function toAlternates(raw: unknown, pickedName: string): string[] {
  if (!Array.isArray(raw)) return [];
  const pick = pickedName.trim().toLowerCase();
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== 'string') continue;
    const name = v.trim().slice(0, MAX_ALTERNATE_LEN);
    if (!name) continue;
    const key = name.toLowerCase();
    if (key === pick || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= MAX_ALTERNATES) break;
  }
  return out;
}

function toNutrients(raw: unknown): FoodNutrients {
  const out: FoodNutrients = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = num(v);
    if (n !== null && n >= 0) out[k as keyof FoodNutrients] = n;
  }
  return out;
}

function shapeResult(parsed: Record<string, unknown>, fallbackBrand: string | null): ResearchOutcome {
  const confidence = num(parsed.confidence) ?? 0;
  if (confidence < MIN_CONFIDENCE) {
    return {
      result: null,
      reason:
        `refused — confidence ${confidence.toFixed(2)} is below the ${MIN_CONFIDENCE} floor this rung holds ` +
        'itself to; a wrong-product match pinned forever is this rung’s whole failure mode',
    };
  }

  const name = typeof parsed.name === 'string' ? parsed.name.trim().slice(0, 200) : '';
  if (!name) {
    return { result: null, reason: 'refused — the lookup returned no product name to pin' };
  }
  const brand =
    typeof parsed.brand === 'string' && parsed.brand.trim() ? parsed.brand.trim().slice(0, 80) : fallbackBrand;
  const base_unit = BASE_UNITS.includes(parsed.base_unit as FoodBaseUnit) ? (parsed.base_unit as FoodBaseUnit) : 'g';

  const macros = toNutrients(parsed.macros_per_100);
  // The whole point of paying for this rung is numbers better than a guess — kcal and the full
  // macro split, or the item falls through to estimate-food.
  const tier = nutritionTier(macros);
  if (tier !== 'macros' && tier !== 'full') {
    return {
      result: null,
      reason:
        `refused — only reached nutrition tier '${tier}', short of the full macro split this rung requires; ` +
        'a thin researched row would still get pinned and reused forever, so the floor here sits above the ledger’s',
    };
  }

  const perServing = toNutrients(parsed.macros_per_serving);
  const servings: FoodServing[] = [];
  const amount = num(parsed.serving_amount);

  /**
   * The two views must agree by arithmetic — the check that catches what Atwater cannot.
   *
   * Caught live on the first real smoke: the label's per-OUNCE numbers filed as per-100g
   * (160 kcal/100g for peanuts — really 160 per 28 g, i.e. 571). Every number was shifted by the
   * same factor, so the macros still implied the kcal and the normalization guard passed it.
   * Internally-consistent-and-wrong is invisible from one view; from two views it is arithmetic:
   * per_100 × amount/100 must land on per_serving. Disagreement means the model did not actually
   * convert, and a 3.5×-light food pinned forever is precisely this rung's worst case.
   */
  if (amount !== null && amount > 0 && typeof perServing.kcal === 'number' && typeof macros.kcal === 'number') {
    const expected = (macros.kcal * amount) / 100;
    const bigger = Math.max(expected, perServing.kcal);
    if (bigger >= 20 && Math.abs(expected - perServing.kcal) / bigger > 0.2) {
      const detail =
        `per-100 (${macros.kcal} kcal) × ${amount}/100 = ${Math.round(expected)} disagrees with the label ` +
        `serving (${perServing.kcal} kcal) — per-serving filed as per-100?`;
      console.warn(`[food-research] rejected: ${detail}`);
      // The disagreement IS the useful part (TOOL-HARNESS): she gets the arithmetic, not just "no".
      return { result: null, reason: `refused — the two views disagree by arithmetic: ${detail}` };
    }
  }
  const label = typeof parsed.serving_label === 'string' ? parsed.serving_label.trim() : '';
  if (amount !== null && amount > 0 && label) {
    servings.push({ label, unit: label, amount_g: amount });
  }
  if (base_unit === 'item') {
    if (servings.length === 0) servings.push({ label: '1 item', unit: 'item', amount_g: 1 });
  } else if (!servings.some((s) => s.amount_g === 100)) {
    servings.push({ label: `100 ${base_unit}`, unit: base_unit, amount_g: 100 });
  }

  const outcome = normalizeFood('research', {
    name,
    brand,
    base_unit,
    macros_per_base: macros,
    servings,
    default_serving: 0,
  });
  if (!outcome.food) {
    return {
      result: null,
      reason: `refused — the normalization guard would not pass it: ${describeNormalizationProblems(outcome.problems)}`,
    };
  }
  if (nutritionTier(outcome.food.macros_per_base) === 'unusable') {
    const detail = describeNormalizationProblems(outcome.problems);
    return {
      result: null,
      reason: `refused — cleanup left too little to use${detail ? `: ${detail}` : ' (the macro split fell apart after normalization)'}`,
    };
  }

  const source_url =
    typeof parsed.source_url === 'string' && /^https?:\/\//.test(parsed.source_url)
      ? parsed.source_url.slice(0, 500)
      : null;
  const alternates = toAlternates(parsed.alternates, name);

  const food: Food = {
    food_id: '',
    owner_user_id: null,
    visibility: 'private',
    name: outcome.food.name,
    brand: outcome.food.brand,
    source: 'research',
    off_id: null,
    fdc_id: null,
    base_unit: outcome.food.base_unit,
    macros_per_base: outcome.food.macros_per_base,
    servings: outcome.food.servings,
    default_serving: outcome.food.default_serving,
    confidence,
    photo_ref: null,
    created_at: '',
  };
  return { result: { food, source_url, alternates }, reason: null };
}

/**
 * Look one food up on the web, once. Null on ANY failure — the waterfall falls through, never over.
 *
 * MP35: the refusal reason now lives in `researchFoodOutcome` below. This function keeps the exact
 * shape it always had — `meal-enrich.ts` (a different parcel's file) calls it and pattern-matches
 * on `null` — so fixing the silence here could not also mean changing a caller this parcel does
 * not own. Any new caller that wants the reason should call `researchFoodOutcome` instead.
 */
export async function researchFood(
  userId: string,
  item: { name: string; brand?: string | null; qty?: number; unit?: string },
): Promise<ResearchedFood | null> {
  return (await researchFoodOutcome(userId, item)).result;
}

/** The full outcome of one lookup — same search as `researchFood`, with the reason attached. */
export async function researchFoodOutcome(
  userId: string,
  item: { name: string; brand?: string | null; qty?: number; unit?: string },
): Promise<ResearchOutcome> {
  const foodText = [item.brand?.trim(), item.name.trim()].filter(Boolean).join(' — ').slice(0, 300);
  if (!foodText) {
    return { result: null, reason: 'nothing to search — the item carried no name or brand to look up' };
  }

  const missKey = foodText.toLowerCase();
  const missedAt = recentMisses.get(missKey);
  if (missedAt && Date.now() - missedAt < RESEARCH_COOLDOWN_MS) {
    return {
      result: null,
      reason: 'nothing new to report — this exact search missed recently and is still in its cooldown window',
    };
  }

  let rawOut = '';
  try {
    const res = await Promise.race([
      runJobBySlug(userId, 'research-food', { food_text: foodText }),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(`research-food timed out after ${RESEARCH_TIMEOUT_MS}ms`)),
          RESEARCH_TIMEOUT_MS,
        ),
      ),
    ]);
    rawOut = res.formatted ?? res.raw ?? '';
    const parsed = firstJsonObject(rawOut);
    const outcome: ResearchOutcome = parsed
      ? shapeResult(parsed, item.brand?.trim() || null)
      : { result: null, reason: 'nothing usable came back — the response carried no readable JSON to shape' };
    void logAi(userId, {
      kind: 'research_food',
      input: { food_text: foodText },
      output: { raw: rawOut.slice(0, 2000) },
      meta: {
        accepted: !!outcome.result,
        name: outcome.result?.food.name ?? null,
        kcal: outcome.result?.food.macros_per_base?.kcal ?? null,
        source_url: outcome.result?.source_url ?? null,
        reason: outcome.reason,
      },
    });
    if (!outcome.result) recentMisses.set(missKey, Date.now());
    return outcome;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn('[food-research] research-food failed — falling through to the estimate:', e);
    void logAi(userId, {
      kind: 'research_food',
      input: { food_text: foodText },
      output: { raw: rawOut.slice(0, 500), error: message },
      meta: { accepted: false },
    });
    recentMisses.set(missKey, Date.now());
    return { result: null, reason: `the lookup broke before it could answer — ${message}` };
  }
}
