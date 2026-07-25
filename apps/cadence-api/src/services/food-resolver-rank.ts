/**
 * Deterministic food ranking + quantity/serving inference (Req 5 §5.6 WS-R).
 * Pure — no DB / AIM. Embeddings and recipe candidates land later.
 */
import type { Food } from '@cadence/shared';
import { type ResolveCandidate, type ResolveCaptureHint, type ResolveInput } from './food-resolver-types.ts';

export interface FoodRankContext {
  /** food_id → use_count for this user (from food_usage). */
  useCountById: ReadonlyMap<string, number>;
  /** food_id → rank in recents list (0 = most recent). */
  recentRankById: ReadonlyMap<string, number>;
  userId: string;
}

export interface RankedFood {
  food: Food;
  score: number;
  preselected_serving: number;
  inferred_quantity: number;
}

/** Lowercase, collapse whitespace, strip light punctuation for matching. */
export function normalizeResolveText(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/[^a-z0-9./\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Singularize simple English plurals for token overlap ("eggs" → "egg"). */
function stemToken(tok: string): string {
  if (tok.length <= 3) return tok;
  if (tok.endsWith('ies') && tok.length > 4) return `${tok.slice(0, -3)}y`;
  if (tok.endsWith('oes') && tok.length > 4) return tok.slice(0, -2);
  if (tok.endsWith('ses') || tok.endsWith('xes') || tok.endsWith('zes')) return tok.slice(0, -2);
  if (tok.endsWith('s') && !tok.endsWith('ss')) return tok.slice(0, -1);
  return tok;
}

function tokens(text: string): string[] {
  return normalizeResolveText(text)
    .split(/[\s/]+/)
    .map(stemToken)
    .filter((t) => t.length > 0 && !STOP.has(t) && !/^\d+(\.\d+)?$/.test(t));
}

const STOP = new Set(['a', 'an', 'the', 'of', 'and', 'with', 'my', 'some', 'about']);

/**
 * Infer quantity from leading phrasing ("3 eggs", "half a bagel", "1/2 cup oats").
 * Defaults to 1 when nothing matches.
 */
export function inferQuantity(text: string): number {
  const raw = text.toLowerCase();
  if (!raw.trim()) return 1;

  if (/\b(half|1\/2)\b/.test(raw)) return 0.5;
  if (/\b(quarter|1\/4)\b/.test(raw)) return 0.25;
  if (/\b(two thirds|2\/3)\b/.test(raw)) return 2 / 3;
  if (/\b(three quarters|3\/4)\b/.test(raw)) return 0.75;

  const t = normalizeResolveText(text);
  const leading = t.match(/^(\d+(?:\.\d+)?)\s+/);
  if (leading) {
    const n = Number(leading[1]);
    if (Number.isFinite(n) && n > 0) return n;
  }

  const about = t.match(/\b(?:about|approx(?:imately)?|~)\s*(\d+(?:\.\d+)?)\b/);
  if (about) {
    const n = Number(about[1]);
    if (Number.isFinite(n) && n > 0) return n;
  }

  return 1;
}

/**
 * Pick a servings[] index from phrasing ("a bowl of oatmeal", "170g yogurt")
 * falling back to food.default_serving.
 */
export function inferServingIndex(text: string, food: Pick<Food, 'servings' | 'default_serving'>): number {
  const servings = Array.isArray(food.servings) ? food.servings : [];
  if (servings.length === 0) return 0;
  const fallback =
    Number.isInteger(food.default_serving) && food.default_serving >= 0 && food.default_serving < servings.length
      ? food.default_serving
      : 0;

  const t = normalizeResolveText(text);
  if (!t) return fallback;

  // Explicit grams: "170g" / "170 g"
  const grams = t.match(/\b(\d+(?:\.\d+)?)\s*g(?:rams?)?\b/);
  if (grams) {
    const g = Number(grams[1]);
    const exact = servings.findIndex((s) => Math.abs(s.amount_g - g) < 0.5 && /g/.test(s.unit));
    if (exact >= 0) return exact;
    const labeled = servings.findIndex((s) => Math.abs(s.amount_g - g) < 0.5);
    if (labeled >= 0) return labeled;
  }

  // Unit token match against serving.unit / label (bowl, cup, container, …)
  let bestIdx = -1;
  let bestLen = 0;
  for (let i = 0; i < servings.length; i++) {
    const s = servings[i]!;
    const unit = normalizeResolveText(s.unit);
    const label = normalizeResolveText(s.label);
    for (const needle of [unit, ...label.split(' ')].filter((w) => w.length >= 2)) {
      if (STOP.has(needle)) continue;
      if (t.includes(needle) && needle.length > bestLen) {
        bestIdx = i;
        bestLen = needle.length;
      }
    }
  }
  return bestIdx >= 0 ? bestIdx : fallback;
}

/** Name/brand lexical score in [0, 1]. */
export function lexicalMatchScore(query: string, food: Pick<Food, 'name' | 'brand'>): number {
  const q = normalizeResolveText(query);
  if (!q) return 0;
  const name = normalizeResolveText(food.name);
  const brand = food.brand ? normalizeResolveText(food.brand) : '';
  const full = brand ? `${brand} ${name}` : name;

  if (name === q || full === q) return 1;
  if (brand && brand === q) return 0.92;
  if (name.startsWith(q) || full.startsWith(q)) return 0.9;
  if (brand && brand.startsWith(q)) return 0.85;
  if (name.includes(q) || full.includes(q)) return 0.78;
  if (brand && brand.includes(q)) return 0.72;

  const qTokens = tokens(q);
  if (qTokens.length === 0) return 0;
  const hay = new Set(tokens(`${brand} ${name}`));
  let hit = 0;
  for (const tok of qTokens) if (hay.has(tok)) hit += 1;
  const ratio = hit / qTokens.length;
  if (ratio >= 1) return 0.82;
  if (ratio >= 0.66) return 0.68;
  if (ratio >= 0.5) return 0.55;
  return 0;
}

/** Round for stable comparisons; allow >1 so ownership/usage can break exact-match ties. */
function roundScore(n: number): number {
  if (n < 0) return 0;
  return Math.round(Math.min(1.5, n) * 1000) / 1000;
}

/**
 * Composite score: lexical match + own-food + usage/recency.
 * Foods with no lexical hit still score from usage when query is empty.
 */
export function scoreFood(query: string, food: Food, ctx: FoodRankContext): number {
  const q = normalizeResolveText(query);
  const lexical = q ? lexicalMatchScore(q, food) : 0;
  const isOwn = food.owner_user_id === ctx.userId;
  const useCount = ctx.useCountById.get(food.food_id) ?? 0;
  const recentRank = ctx.recentRankById.get(food.food_id);

  let score = lexical;
  if (!q) {
    // Empty query: recency primary, light frequency secondary (MFP recents-first).
    const recentBoost = recentRank !== undefined ? Math.max(0, 1 - recentRank * 0.05) : 0.35;
    const freqBoost = Math.min(0.08, useCount * 0.005);
    score = recentBoost + freqBoost;
  } else if (lexical <= 0) {
    return 0;
  }

  if (isOwn) score += 0.08;
  if (useCount > 0 && q) score += Math.min(0.12, useCount * 0.015);
  if (recentRank !== undefined && recentRank < 5 && q) score += 0.04;

  return roundScore(score);
}

/** Rank foods; drops zero-score rows when query is non-empty. */
export function rankFoods(query: string, foods: readonly Food[], ctx: FoodRankContext): RankedFood[] {
  const qty = inferQuantity(query);
  const scored: RankedFood[] = [];
  for (const food of foods) {
    const score = scoreFood(query, food, ctx);
    if (normalizeResolveText(query) && score <= 0) continue;
    scored.push({
      food,
      score,
      preselected_serving: inferServingIndex(query, food),
      inferred_quantity: qty,
    });
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Stable tie-break: own first, then name.
    const aOwn = a.food.owner_user_id === ctx.userId ? 0 : 1;
    const bOwn = b.food.owner_user_id === ctx.userId ? 0 : 1;
    if (aOwn !== bOwn) return aOwn - bOwn;
    return a.food.name.localeCompare(b.food.name);
  });
  return scored;
}

export function foodLabel(f: Pick<Food, 'name' | 'brand'>): string {
  return f.brand ? `${f.name} (${f.brand})` : f.name;
}

/** Build the "new food" escape hatch with the right capture path hook. */
export function newFoodCandidate(input: ResolveInput): ResolveCandidate {
  const text = typeof input.text === 'string' ? input.text.trim() : '';
  const hasPhoto = typeof input.photo === 'string' && input.photo.startsWith('data:image/');
  const capture: ResolveCaptureHint = hasPhoto
    ? { path: 'parse-label', ...(text ? { text } : {}) }
    : { path: 'estimate', text: text || undefined };
  const label = hasPhoto
    ? text
      ? `Add "${text}" from this label`
      : 'Add a new food from this label'
    : `Add "${text}" as a new food`;
  return { kind: 'new', score: 0, label, capture };
}
