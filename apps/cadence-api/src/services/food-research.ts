import type { Food, FoodBaseUnit, FoodNutrients, FoodServing } from '@cadence/shared';
import { runJobBySlug } from '../ai/aim.ts';
import { logAi } from './ai-log.ts';
import { applyNormalization } from './food-sources/normalized.ts';
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

function toNutrients(raw: unknown): FoodNutrients {
  const out: FoodNutrients = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const n = num(v);
    if (n !== null && n >= 0) out[k as keyof FoodNutrients] = n;
  }
  return out;
}

function shapeResult(parsed: Record<string, unknown>, fallbackBrand: string | null): ResearchedFood | null {
  const confidence = num(parsed.confidence) ?? 0;
  if (confidence < MIN_CONFIDENCE) return null;

  const name = typeof parsed.name === 'string' ? parsed.name.trim().slice(0, 200) : '';
  if (!name) return null;
  const brand =
    typeof parsed.brand === 'string' && parsed.brand.trim() ? parsed.brand.trim().slice(0, 80) : fallbackBrand;
  const base_unit = BASE_UNITS.includes(parsed.base_unit as FoodBaseUnit) ? (parsed.base_unit as FoodBaseUnit) : 'g';

  const macros = toNutrients(parsed.macros_per_100);
  // The whole point of paying for this rung is numbers better than a guess — kcal and the full
  // macro split, or the item falls through to estimate-food.
  const tier = nutritionTier(macros);
  if (tier !== 'macros' && tier !== 'full') return null;

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
      console.warn(
        `[food-research] rejected: per-100 (${macros.kcal} kcal) × ${amount}/100 = ${Math.round(expected)} ` +
          `disagrees with the label serving (${perServing.kcal} kcal) — per-serving filed as per-100?`,
      );
      return null;
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

  const normalized = applyNormalization('research', {
    name,
    brand,
    base_unit,
    macros_per_base: macros,
    servings,
    default_serving: 0,
  });
  if (!normalized || nutritionTier(normalized.macros_per_base) === 'unusable') return null;

  const source_url =
    typeof parsed.source_url === 'string' && /^https?:\/\//.test(parsed.source_url)
      ? parsed.source_url.slice(0, 500)
      : null;

  const food: Food = {
    food_id: '',
    owner_user_id: null,
    visibility: 'private',
    name: normalized.name,
    brand: normalized.brand,
    source: 'research',
    off_id: null,
    fdc_id: null,
    base_unit: normalized.base_unit,
    macros_per_base: normalized.macros_per_base,
    servings: normalized.servings,
    default_serving: normalized.default_serving,
    confidence,
    photo_ref: null,
    created_at: '',
  };
  return { food, source_url };
}

/** Look one food up on the web, once. Null on ANY failure — the waterfall falls through, never over. */
export async function researchFood(
  userId: string,
  item: { name: string; brand?: string | null; qty?: number; unit?: string },
): Promise<ResearchedFood | null> {
  const foodText = [item.brand?.trim(), item.name.trim()].filter(Boolean).join(' — ').slice(0, 300);
  if (!foodText) return null;

  const missKey = foodText.toLowerCase();
  const missedAt = recentMisses.get(missKey);
  if (missedAt && Date.now() - missedAt < RESEARCH_COOLDOWN_MS) return null;

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
    const shaped = parsed ? shapeResult(parsed, item.brand?.trim() || null) : null;
    void logAi(userId, {
      kind: 'research_food',
      input: { food_text: foodText },
      output: { raw: rawOut.slice(0, 2000) },
      meta: {
        accepted: !!shaped,
        name: shaped?.food.name ?? null,
        kcal: shaped?.food.macros_per_base?.kcal ?? null,
        source_url: shaped?.source_url ?? null,
      },
    });
    if (!shaped) recentMisses.set(missKey, Date.now());
    return shaped;
  } catch (e) {
    console.warn('[food-research] research-food failed — falling through to the estimate:', e);
    void logAi(userId, {
      kind: 'research_food',
      input: { food_text: foodText },
      output: { raw: rawOut.slice(0, 500), error: e instanceof Error ? e.message : String(e) },
      meta: { accepted: false },
    });
    recentMisses.set(missKey, Date.now());
    return null;
  }
}
