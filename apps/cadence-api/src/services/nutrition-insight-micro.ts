/**
 * Req 5 Phase 3 — micronutrient insights (zinc / iron class).
 *
 * Pure: no DB, no LLM. Micros only from real-data foods (usda / off / label_photo).
 * Gate when coverage is thin — never invent a "likely low" from LLM-estimated meals.
 */
import { macrosForLog, type Food, type FoodSource, type NutritionLog } from '@cadence/shared';

export interface MicroInsightItem {
  kind: 'micro';
  body: string;
}

/** Sources allowed to drive micro insights (never llm/chat/manual guesses). */
const REAL_MICRO_SOURCES = new Set<FoodSource>(['usda', 'off', 'label_photo', 'fatsecret']);

/** Adult-ish daily anchors — conservative "likely low" floors, not clinical targets. */
const ZINC_LOW_MG_PER_DAY = 7;
const IRON_LOW_MG_PER_DAY = 8;

/** Need enough linked real-data items before speaking. */
const MIN_LINKED_ITEMS = 3;
const MIN_DAYS_LOGGED = 3;
/** Of food-linked confirmed items, this fraction must carry the micro. */
const MIN_COVERAGE = 0.4;

export type MicroNutrientKey = 'zinc_mg' | 'iron_mg';

export interface MicroInsightRollup {
  days_logged: number;
  /** Confirmed log items that point at a food_id (any source). */
  linked_items: number;
  zinc: { covered: number; total_mg: number };
  iron: { covered: number; total_mg: number };
}

function isRealMicroFood(food: Food): boolean {
  return REAL_MICRO_SOURCES.has(food.source);
}

/**
 * Build a micro rollup from recent confirmed logs + loaded foods.
 * Scales via macrosForLog (default serving × item qty).
 */
export function buildMicroInsightRollup(
  recent: Array<Pick<NutritionLog, 'provisional' | 'items'>>,
  foodsById: Map<string, Food>,
  daysLogged: number,
): MicroInsightRollup {
  let linkedItems = 0;
  const zinc = { covered: 0, total_mg: 0 };
  const iron = { covered: 0, total_mg: 0 };

  for (const row of recent) {
    if (row.provisional) continue;
    for (const item of row.items ?? []) {
      const foodId = typeof item.food_id === 'string' ? item.food_id : '';
      if (!foodId) continue;
      const food = foodsById.get(foodId);
      if (!food) continue;
      linkedItems += 1;
      if (!isRealMicroFood(food)) continue;

      const qty = typeof item.qty === 'number' && item.qty > 0 ? item.qty : 1;
      const nutrients = macrosForLog(food, { quantity: qty });

      if (typeof nutrients.zinc_mg === 'number' && Number.isFinite(nutrients.zinc_mg)) {
        zinc.covered += 1;
        zinc.total_mg += nutrients.zinc_mg;
      }
      if (typeof nutrients.iron_mg === 'number' && Number.isFinite(nutrients.iron_mg)) {
        iron.covered += 1;
        iron.total_mg += nutrients.iron_mg;
      }
    }
  }

  return { days_logged: daysLogged, linked_items: linkedItems, zinc, iron };
}

function coverageOk(covered: number, linkedItems: number, daysLogged: number): boolean {
  if (daysLogged < MIN_DAYS_LOGGED) return false;
  if (linkedItems < MIN_LINKED_ITEMS) return false;
  if (covered < MIN_LINKED_ITEMS) return false;
  return covered / linkedItems >= MIN_COVERAGE;
}

function avgPerDay(totalMg: number, daysLogged: number): number {
  const d = Math.max(1, daysLogged);
  return totalMg / d;
}

/** Zinc / iron coaching lines when coverage and averages support them. */
export function microInsights(rollup: MicroInsightRollup): MicroInsightItem[] {
  const out: MicroInsightItem[] = [];

  if (coverageOk(rollup.zinc.covered, rollup.linked_items, rollup.days_logged)) {
    const avg = avgPerDay(rollup.zinc.total_mg, rollup.days_logged);
    if (avg < ZINC_LOW_MG_PER_DAY) {
      out.push({
        kind: 'micro',
        body: "From the foods I can read micros for, you're likely a little low on zinc this week — pumpkin seeds or chickpeas would help when you're next at the store.",
      });
    }
  }

  if (coverageOk(rollup.iron.covered, rollup.linked_items, rollup.days_logged)) {
    const avg = avgPerDay(rollup.iron.total_mg, rollup.days_logged);
    if (avg < IRON_LOW_MG_PER_DAY) {
      out.push({
        kind: 'micro',
        body: "Iron looks a bit light in the foods I can measure — a handful of spinach or lentils would round that out. No pressure; just something I'm noticing.",
      });
    }
  }

  return out;
}
