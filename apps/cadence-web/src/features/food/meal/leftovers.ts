/**
 * The Leftovers shelf — meals you logged recently, most recent at the top (owner, 2026-10-28,
 * replacing the batch/yield reading the canvas drew: "2 of 4 left" asked the user to have cooked
 * through a recipe with a yield, and nobody's Tuesday leftovers went through that door). Tapping
 * one puts that meal's rows back in the cart, priced as they were logged.
 *
 * Pure over the recent-meals read the app already caches. The window is the user's
 * (Settings → Nutrition, `leftoverWindow.ts`); seven days unless they change it.
 *
 * What is NOT a leftover: an open meal (it has not been eaten yet — the draft in front of you
 * included), an empty one, and a second copy of a meal already on the shelf (the same name a
 * day later is the same food; the newest stands for it).
 */
import type { Macros, MealItem, MealKind, MealPart, MealState } from '@cadence/shared';
import { numberWord } from '../bracket/copy.ts';

export interface LeftoverSource {
  log_id: string;
  /** YYYY-MM-DD */
  date: string;
  meal: MealKind;
  items: MealItem[];
  parts?: MealPart[] | null;
  macros?: Macros;
  state?: MealState;
}

export interface Leftover {
  log_id: string;
  name: string;
  date: string;
  meal: MealKind;
  kcal: number | null;
  macros: Macros;
  items: MealItem[];
  parts: MealPart[];
}

const DAY_MS = 86_400_000;

/** Days from `from` to `to`, both YYYY-MM-DD, read as UTC so a timezone never shifts a date. */
export function daysBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const a = Date.UTC(fy ?? 0, (fm ?? 1) - 1, fd ?? 1);
  const b = Date.UTC(ty ?? 0, (tm ?? 1) - 1, td ?? 1);
  return Math.round((b - a) / DAY_MS);
}

/** Within one day, the later slot is the more recent meal. Snacks/drinks/other have no clock. */
const SLOT_ORDER: Record<MealKind, number> = { breakfast: 0, lunch: 1, snack: 2, drink: 2, other: 2, dinner: 3 };

/**
 * What the meal was, in its own words: named brackets by name, everything else by item, the first
 * three and a count of the rest — "Lentil stew · Side salad + two more". A dot, not a comma: food
 * names carry their own commas ("Eggs, scrambled").
 */
export function mealName(items: MealItem[], parts: MealPart[]): string {
  const named = new Map(parts.filter((p) => p.name).map((p) => [p.key, p.name!]));
  const words: string[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    const word = it.part && named.has(it.part) ? named.get(it.part)! : it.name;
    const key = it.part && named.has(it.part) ? `part:${it.part}` : `item:${word.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    words.push(word);
  }
  if (words.length <= 3) return words.join(' · ');
  return `${words.slice(0, 2).join(' · ')} + ${numberWord(words.length - 2)} more`;
}

function kcalOf(s: LeftoverSource): number | null {
  if (typeof s.macros?.kcal === 'number') return s.macros.kcal;
  let sum: number | null = null;
  for (const it of s.items) if (typeof it.est?.kcal === 'number') sum = (sum ?? 0) + it.est.kcal;
  return sum;
}

/** The shelf, newest first. `windowDays` back from today, today included. */
export function deriveLeftovers(
  sources: LeftoverSource[],
  today: string,
  windowDays: number,
  excludeLogId?: string | null,
): Leftover[] {
  const fresh = sources
    .filter((s) => {
      if (s.log_id === excludeLogId || s.state === 'open' || s.items.length === 0) return false;
      const age = daysBetween(s.date, today);
      return age >= 0 && age <= windowDays;
    })
    .sort((a, b) => (a.date !== b.date ? (a.date < b.date ? 1 : -1) : SLOT_ORDER[b.meal] - SLOT_ORDER[a.meal]));

  const out: Leftover[] = [];
  const names = new Set<string>();
  for (const s of fresh) {
    const parts = s.parts ?? [];
    const name = mealName(s.items, parts);
    if (names.has(name.toLowerCase())) continue;
    names.add(name.toLowerCase());
    out.push({
      log_id: s.log_id,
      name,
      date: s.date,
      meal: s.meal,
      kcal: kcalOf(s),
      macros: s.macros ?? {},
      items: s.items,
      parts,
    });
  }
  return out;
}

/** "yesterday · dinner" — "today", "yesterday", the weekday inside a week, the date past it. */
export function leftoverLine(l: Pick<Leftover, 'date' | 'meal'>, today: string): string {
  const age = daysBetween(l.date, today);
  const d = new Date(`${l.date}T12:00:00`);
  const when =
    age === 0
      ? 'today'
      : age === 1
        ? 'yesterday'
        : age < 7
          ? d.toLocaleDateString('en-GB', { weekday: 'short' })
          : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  return `${when} · ${l.meal}`;
}
