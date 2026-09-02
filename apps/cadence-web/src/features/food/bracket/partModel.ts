/**
 * The bracket, as data (P2 of the meal-logging rework — docs/cadence/MEAL-LOGGING.md).
 *
 * Pure helpers over a meal's `items` + `parts`, plus the pure reducers the gestures preview with
 * BEFORE the server answers. The reducers mirror `MealPartOp` (lib/api/meal-draft.ts) exactly:
 * group / ungroup / add / remove / rename. Two rules they enforce, same as the server:
 *
 *   • No reducer ever touches an item's `est` — grouping changes no numbers, ever.
 *   • A part below two members dissolves on its own — a recipe of one item isn't a recipe.
 */
import type { Macros, MealItem, MealPart } from '@cadence/shared';

export interface PartsState {
  items: MealItem[];
  parts: MealPart[];
}

/** One display row: a part drawn as a block at its first member's place, or a loose item. */
export type BracketRow =
  | { kind: 'part'; part: MealPart; memberIndexes: number[] }
  | { kind: 'item'; index: number; item: MealItem };

function knownKeys(parts: MealPart[]): Set<string> {
  return new Set(parts.map((p) => p.key));
}

/** Indexes of the items inside a part, in item order. */
export function membersOf(items: MealItem[], partKey: string): number[] {
  const out: number[] = [];
  items.forEach((it, i) => {
    if (it.part === partKey) out.push(i);
  });
  return out;
}

/**
 * Indexes of the items outside every bracket. An item pointing at a part key that does not exist
 * reads as loose rather than vanishing — a dangling reference is a bug to surface, not food to hide.
 */
export function looseItems(items: MealItem[], parts: MealPart[]): number[] {
  const keys = knownKeys(parts);
  const out: number[] = [];
  items.forEach((it, i) => {
    if (!it.part || !keys.has(it.part)) out.push(i);
  });
  return out;
}

/**
 * Sum the members' `est` — every numeric key present, not a hand-copied list. `Macros` is numbers
 * plus the string `source`, so summing what is numeric covers exactly the twelve summed nutrient
 * keys (the same set useMealAmounts.ts names) and cannot drift when a nutrient is added. Absent
 * keys stay absent: a total is a floor, never an invented zero.
 */
export function sumEst(items: MealItem[], indexes: number[]): Macros {
  const total: Record<string, number> = {};
  for (const i of indexes) {
    const est = items[i]?.est;
    if (!est) continue;
    for (const [k, v] of Object.entries(est)) {
      if (typeof v === 'number') total[k] = (total[k] ?? 0) + v;
    }
  }
  return total as Macros;
}

export function partTotal(items: MealItem[], partKey: string): Macros {
  return sumEst(items, membersOf(items, partKey));
}

/** The pill's word: the name they gave it, or a plain count. Unnamed reads as "4 things". */
export function partLabel(part: MealPart, memberCount: number): string {
  if (part.name) return part.name;
  return memberCount === 1 ? '1 thing' : `${memberCount} things`;
}

/** Butter bracket territory: the part's recipe made several portions. */
export function makesSeveral(part: MealPart): boolean {
  return typeof part.yield_servings === 'number' && part.yield_servings > 1;
}

/**
 * The collapsed row's second line. Yield rides the same mark with no new row type: a part logged
 * as a portion of several reads "1 of 4 servings"; everything else reads "4 things" (canvas A4).
 */
export function collapsedSub(part: MealPart, memberCount: number): string {
  if (makesSeveral(part) && typeof part.servings_logged === 'number') {
    return `${part.servings_logged} of ${part.yield_servings} servings`;
  }
  return memberCount === 1 ? '1 thing' : `${memberCount} things`;
}

/** Display order: each part appears once, as a block where its first member sits; loose in place. */
export function orderedRows(items: MealItem[], parts: MealPart[]): BracketRow[] {
  const keys = knownKeys(parts);
  const byKey = new Map(parts.map((p) => [p.key, p]));
  const seen = new Set<string>();
  const rows: BracketRow[] = [];
  items.forEach((item, index) => {
    const key = item.part && keys.has(item.part) ? item.part : null;
    if (!key) {
      rows.push({ kind: 'item', index, item });
      return;
    }
    if (seen.has(key)) return;
    seen.add(key);
    const part = byKey.get(key);
    if (part) rows.push({ kind: 'part', part, memberIndexes: membersOf(items, key) });
  });
  return rows;
}

/** True when taking one more member out would dissolve the bracket (two or fewer members). */
export function canDissolve(items: MealItem[], partKey: string): boolean {
  return membersOf(items, partKey).length <= 2;
}

/** Smallest `p<n>` no existing part uses. Stable within one meal, matching the server's habit. */
export function nextPartKey(parts: MealPart[]): string {
  const used = knownKeys(parts);
  let n = 1;
  while (used.has(`p${n}`)) n += 1;
  return `p${n}`;
}

function withoutPart(item: MealItem): MealItem {
  const { part: _part, ...rest } = item;
  return rest;
}

/**
 * Bracket loose rows into a new part (op `group`). Indexes already inside a bracket are ignored —
 * nested brackets are refused — and fewer than two survivors is a no-op: nothing to make.
 */
export function groupIndexes(state: PartsState, indexes: number[], name?: string | null): PartsState {
  const loose = new Set(looseItems(state.items, state.parts));
  const chosen = [...new Set(indexes)].filter((i) => loose.has(i)).sort((a, b) => a - b);
  if (chosen.length < 2) return state;
  const key = nextPartKey(state.parts);
  const set = new Set(chosen);
  return {
    items: state.items.map((it, i) => (set.has(i) ? { ...it, part: key } : it)),
    parts: [...state.parts, { key, name: name ?? null, source: 'user' }],
  };
}

/** Dissolve a bracket (op `ungroup`). Same food, same numbers — only how the day reads back. */
export function ungroup(state: PartsState, partKey: string): PartsState {
  if (!knownKeys(state.parts).has(partKey)) return state;
  return {
    items: state.items.map((it) => (it.part === partKey ? withoutPart(it) : it)),
    parts: state.parts.filter((p) => p.key !== partKey),
  };
}

/** A loose row joins a bracket (op `add`). Only a loose item can join — no nesting, no theft. */
export function addToPart(state: PartsState, partKey: string, index: number): PartsState {
  if (!knownKeys(state.parts).has(partKey)) return state;
  const item = state.items[index];
  if (!item || (item.part && knownKeys(state.parts).has(item.part))) return state;
  return {
    items: state.items.map((it, i) => (i === index ? { ...it, part: partKey } : it)),
    parts: state.parts,
  };
}

/**
 * A member leaves its bracket (op `remove`). Taking the second-to-last one out dissolves the
 * bracket entirely — the remaining member goes loose and the part row disappears.
 */
export function removeFromPart(state: PartsState, partKey: string, index: number): PartsState {
  const item = state.items[index];
  if (!item || item.part !== partKey) return state;
  const remaining = membersOf(state.items, partKey).filter((i) => i !== index);
  if (remaining.length < 2) {
    return {
      items: state.items.map((it) => (it.part === partKey ? withoutPart(it) : it)),
      parts: state.parts.filter((p) => p.key !== partKey),
    };
  }
  return {
    items: state.items.map((it, i) => (i === index ? withoutPart(it) : it)),
    parts: state.parts,
  };
}

/** Name (or un-name) a bracket (op `rename`). Naming never touches membership or numbers. */
export function renamePart(state: PartsState, partKey: string, name: string | null): PartsState {
  if (!knownKeys(state.parts).has(partKey)) return state;
  return {
    items: state.items,
    parts: state.parts.map((p) => (p.key === partKey ? { ...p, name } : p)),
  };
}
