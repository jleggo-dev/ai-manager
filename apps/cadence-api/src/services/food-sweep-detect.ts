/**
 * The Sunday sweep, deterministic half (S3): find which item sets keep turning up together.
 *
 * Counts, not opinions. This module reads the last 45 days of closed meals and reports, per meal
 * slot, the maximal sets of >= 2 saved foods that appeared together (loose — items already inside
 * a bracket are excluded) on >= 3 distinct days. Greedy growth from the most frequent pair:
 * explainable beats optimal. It also counts, for each set, the days the meal was EXACTLY that set
 * and nothing else — the repeated-identical-dinner signal a yield judgement needs ("eaten four
 * times, identical every time" reads like one cooking that made four).
 *
 * The model downstream only names, drops, and spots yield. Nothing here — and nothing after
 * here — ever changes a logged number: the per-serving macros are summed from the items' own est.
 */
import type { Macros, MealItem, MealKind } from '@cadence/shared';
import { listSweepLogs, type SweepLogRow } from '../repos/nutrition-sweep.ts';

export const SWEEP_WINDOW_DAYS = 45;
/** A set must be seen on this many distinct days. Never a set seen once — that is a rail, not a tuning knob. */
export const MIN_DISTINCT_DAYS = 3;
const MIN_SET_SIZE = 2;
const MAX_CANDIDATES = 6;
const MAX_FRAGMENTS = 5;
const FRAGMENT_MAX_CHARS = 140;

export interface SweepCandidateMember {
  food_id: string;
  name: string;
  qty?: number;
  unit?: string;
}

export interface SweepCandidate {
  candidate_id: string;
  slot: MealKind;
  /** Distinct days the set appeared together in this slot. */
  seen_count: number;
  /** Distinct days the meal was EXACTLY this set — the batch/yield signal for the model. */
  identical_meal_days: number;
  members: SweepCandidateMember[];
  /** The user's own raw words from the logs that contained the set — the model names from these. */
  raw_fragments: string[];
  /** Logs whose loose items contain the set — the retro tidy's target list. */
  tidy_log_ids: string[];
  /** Summed from the member items' own est at their modal amounts. Deterministic, never modeled. */
  macros_per_serving: Macros;
}

/** One log flattened for mining: its loose (un-bracketed) saved-food items. */
interface Entry {
  logId: string;
  date: string;
  rawText: string | null;
  /** First loose instance per food_id (amounts + est come from here). */
  byFood: Map<string, MealItem>;
  foods: Set<string>;
}

const MACRO_KEYS = [
  'kcal',
  'protein_g',
  'carbs_g',
  'fat_g',
  'fiber_g',
  'sodium_mg',
  'iron_mg',
  'zinc_mg',
  'vitamin_c_mg',
  'calcium_mg',
  'potassium_mg',
  'vitamin_b12_ug',
] as const satisfies readonly (keyof Macros)[];

/** Sum est blobs field-by-field; a field nobody carries stays absent rather than becoming 0. */
function sumMacros(list: (Macros | undefined)[]): Macros {
  const out: Macros = {};
  for (const key of MACRO_KEYS) {
    let total = 0;
    let saw = false;
    for (const m of list) {
      const v = m?.[key];
      if (typeof v === 'number' && Number.isFinite(v)) {
        total += v;
        saw = true;
      }
    }
    if (saw) out[key] = Math.round(total * 10) / 10;
  }
  return out;
}

function toEntry(row: SweepLogRow): Entry | null {
  const byFood = new Map<string, MealItem>();
  for (const item of Array.isArray(row.items) ? row.items : []) {
    // Only loose items with a saved food behind them can become recipe members.
    if (item.part || !item.food_id) continue;
    if (!byFood.has(item.food_id)) byFood.set(item.food_id, item);
  }
  if (byFood.size < MIN_SET_SIZE) return null;
  return { logId: row.log_id, date: row.date, rawText: row.raw_text, byFood, foods: new Set(byFood.keys()) };
}

/** Distinct dates among entries whose loose foods contain every member of `set`. */
function supportDays(entries: Entry[], set: string[]): Set<string> {
  const days = new Set<string>();
  for (const e of entries) {
    if (set.every((f) => e.foods.has(f))) days.add(e.date);
  }
  return days;
}

/** Grow a seed pair greedily: keep adding the food that preserves the highest day-support, while
 *  support stays at or above the floor. Deterministic ties (lexical food_id). */
function growSet(entries: Entry[], seed: string[], allFoods: string[], used: Set<string>): string[] {
  const set = [...seed];
  for (;;) {
    let best: { food: string; support: number } | null = null;
    for (const f of allFoods) {
      if (set.includes(f) || used.has(f)) continue;
      const support = supportDays(entries, [...set, f]).size;
      if (support < MIN_DISTINCT_DAYS) continue;
      if (!best || support > best.support || (support === best.support && f < best.food)) {
        best = { food: f, support };
      }
    }
    if (!best) return set.sort();
    set.push(best.food);
  }
}

/** The most common value wins; on a tie, the latest-seen. */
function modal<T>(values: T[], keyOf: (v: T) => string): T | undefined {
  const counts = new Map<string, { value: T; n: number }>();
  for (const v of values) {
    const k = keyOf(v);
    const cur = counts.get(k);
    if (cur) {
      cur.n += 1;
      cur.value = v; // latest occurrence represents the key
    } else counts.set(k, { value: v, n: 1 });
  }
  let best: { value: T; n: number } | undefined;
  for (const c of counts.values()) if (!best || c.n >= best.n) best = c;
  return best?.value;
}

function buildMember(foodId: string, matching: Entry[]): { member: SweepCandidateMember; est?: Macros } {
  const instances = matching.map((e) => e.byFood.get(foodId)).filter((i): i is MealItem => !!i);
  const modalAmount = modal(instances, (i) => `${i.qty ?? ''}|${i.unit ?? ''}`);
  const name = modal(instances, (i) => i.name.trim().toLowerCase())?.name ?? instances[0]?.name ?? '';
  // est for the modal amount, from its latest occurrence; any est at all as the fallback.
  const atModal = instances.filter(
    (i) => (i.qty ?? '') === (modalAmount?.qty ?? '') && (i.unit ?? '') === (modalAmount?.unit ?? ''),
  );
  const est = [...atModal].reverse().find((i) => i.est)?.est ?? [...instances].reverse().find((i) => i.est)?.est;
  return {
    member: {
      food_id: foodId,
      name,
      ...(modalAmount?.qty !== undefined ? { qty: modalAmount.qty } : {}),
      ...(modalAmount?.unit !== undefined ? { unit: modalAmount.unit } : {}),
    },
    ...(est ? { est } : {}),
  };
}

function buildCandidate(slot: MealKind, set: string[], entries: Entry[]): Omit<SweepCandidate, 'candidate_id'> {
  const matching = entries.filter((e) => set.every((f) => e.foods.has(f)));
  const seenDays = new Set(matching.map((e) => e.date));
  const identicalDays = new Set(matching.filter((e) => e.foods.size === set.length).map((e) => e.date));
  const built = set.map((f) => buildMember(f, matching));
  const fragments: string[] = [];
  for (const e of [...matching].reverse()) {
    const text = e.rawText?.trim().slice(0, FRAGMENT_MAX_CHARS);
    if (text && !fragments.includes(text)) fragments.push(text);
    if (fragments.length >= MAX_FRAGMENTS) break;
  }
  return {
    slot,
    seen_count: seenDays.size,
    identical_meal_days: identicalDays.size,
    members: built.map((b) => b.member),
    raw_fragments: fragments,
    tidy_log_ids: matching.map((e) => e.logId),
    macros_per_serving: sumMacros(built.map((b) => b.est)),
  };
}

/** Mine one slot: frequent pairs first, each grown to a maximal set; a food joins one set only. */
function mineSlot(slot: MealKind, entries: Entry[]): Omit<SweepCandidate, 'candidate_id'>[] {
  const pairDays = new Map<string, Set<string>>();
  for (const e of entries) {
    const foods = [...e.foods].sort();
    for (let i = 0; i < foods.length; i++) {
      for (let j = i + 1; j < foods.length; j++) {
        const key = `${foods[i]}|${foods[j]}`;
        (pairDays.get(key) ?? pairDays.set(key, new Set()).get(key)!).add(e.date);
      }
    }
  }
  const frequentPairs = [...pairDays.entries()]
    .filter(([, days]) => days.size >= MIN_DISTINCT_DAYS)
    .sort((a, b) => b[1].size - a[1].size || (a[0] < b[0] ? -1 : 1));

  const allFoods = [...new Set([...pairDays.keys()].flatMap((k) => k.split('|')))].sort();
  const used = new Set<string>();
  const out: Omit<SweepCandidate, 'candidate_id'>[] = [];
  for (const [key] of frequentPairs) {
    const [a, b] = key.split('|') as [string, string];
    if (used.has(a) || used.has(b)) continue;
    const set = growSet(entries, [a, b], allFoods, used);
    if (supportDays(entries, set).size < MIN_DISTINCT_DAYS) continue;
    for (const f of set) used.add(f);
    out.push(buildCandidate(slot, set, entries));
  }
  return out;
}

/** Pure detection over pre-read rows — what the tests pin. Capped, ordered, ids assigned. */
export function findSweepCandidates(rows: SweepLogRow[]): SweepCandidate[] {
  const bySlot = new Map<MealKind, Entry[]>();
  for (const row of rows) {
    const entry = toEntry(row);
    if (!entry) continue;
    (bySlot.get(row.meal) ?? bySlot.set(row.meal, []).get(row.meal)!).push(entry);
  }
  const all: Omit<SweepCandidate, 'candidate_id'>[] = [];
  for (const [slot, entries] of bySlot) all.push(...mineSlot(slot, entries));
  all.sort((a, b) => b.seen_count - a.seen_count || b.identical_meal_days - a.identical_meal_days);
  return all.slice(0, MAX_CANDIDATES).map((c, i) => ({ candidate_id: `c${i + 1}`, ...c }));
}

/** Read the window and mine it. `today` is injectable for tests. */
export async function detectSweepCandidates(userId: string, today = new Date()): Promise<SweepCandidate[]> {
  const to = today.toISOString().slice(0, 10);
  const from = new Date(today.getTime() - SWEEP_WINDOW_DAYS * 86_400_000).toISOString().slice(0, 10);
  return findSweepCandidates(await listSweepLogs(userId, from, to));
}
