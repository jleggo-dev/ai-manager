/**
 * A stored session rearranged by the coach (walkthrough v3 Phase 6, R2's agentic path): the SAME
 * items in a new block structure. Two pure checks and one mapping, shared by the API's
 * `rearrange-session` job path and its tests:
 *
 *   • `sameItems` — the item set is unchanged: the same names, and the same number of sets per
 *     name in total (a move spread through the session is the same move in more places).
 *   • `carryItems` — the rearranged session with every item's fields taken from the original by
 *     name, so the job can decide only WHERE a move sits and how its sets are split, never what
 *     it is or how heavy.
 *   • `shapeOfRearranged` — the new structure as a played shape over the original's steps, so the
 *     structure diff (played-diff.ts) can say what changed in the same fixed words the Recap uses.
 */
import type { OccurrenceSession, SessionBlock, SessionItem } from './types/occurrence.ts';
import { inferTool } from './walkthrough.ts';
import { type PlayedGroup, type PlayedShape, type Turn, setCount } from './played-shape.ts';

const key = (name: string) => name.trim().toLowerCase().replace(/\s+/g, ' ');
const setsOf = (item: SessionItem) => setCount(inferTool(item));

function items(session: Pick<OccurrenceSession, 'blocks'>): SessionItem[] {
  return session.blocks.flatMap((b) => b.items ?? []);
}

/** Sets per item name, summed over every place the name appears. */
function setTotals(session: Pick<OccurrenceSession, 'blocks'>): Map<string, number> {
  const out = new Map<string, number>();
  for (const it of items(session)) out.set(key(it.name), (out.get(key(it.name)) ?? 0) + setsOf(it));
  return out;
}

/** The same moves, and the same number of sets of each, however they are grouped. */
export function sameItems(
  before: Pick<OccurrenceSession, 'blocks'>,
  after: Pick<OccurrenceSession, 'blocks'>,
): boolean {
  const a = setTotals(before);
  const b = setTotals(after);
  if (a.size !== b.size) return false;
  for (const [name, n] of a) if (b.get(name) !== n) return false;
  return true;
}

/**
 * The rearranged session with each item's fields carried from the original by name. Only `sets`
 * is taken from the answer (how the move is split up); everything else — reps, load, length,
 * cue, tool, alternatives — is the original's. Block labels, modes and rounds are the answer's.
 * Null when a name in the answer is not in the original, or appears more often than its sets allow.
 */
export function carryItems(
  before: OccurrenceSession,
  after: Pick<OccurrenceSession, 'blocks' | 'note'>,
): OccurrenceSession | null {
  const pool = new Map<string, SessionItem[]>();
  for (const it of items(before)) pool.set(key(it.name), [...(pool.get(key(it.name)) ?? []), it]);
  const used = new Map<string, number>();
  const blocks: SessionBlock[] = [];
  for (const b of after.blocks) {
    const out: SessionItem[] = [];
    for (const it of b.items ?? []) {
      const originals = pool.get(key(it.name));
      const original = originals?.[Math.min(used.get(key(it.name)) ?? 0, originals.length - 1)];
      if (!original) return null;
      used.set(key(it.name), (used.get(key(it.name)) ?? 0) + 1);
      const sets = typeof it.sets === 'number' && it.sets > 0 ? Math.round(it.sets) : undefined;
      const carried: SessionItem = { ...original };
      if (sets !== undefined) carried.sets = sets;
      else if (setsOf(original) > 1 && original.sets) carried.sets = original.sets;
      out.push(carried);
    }
    blocks.push({ ...b, items: out });
  }
  const result: OccurrenceSession = { ...before, blocks, note: after.note?.trim() || before.note };
  return sameItems(before, result) ? result : null;
}

/**
 * The new structure as a played shape over the original's steps: a straight block's item is a
 * group of that move's next sets; a circuit block is one combined group of its items' sets,
 * round by round. A circuit the original already had stays one turn. Null when the two do not
 * hold the same items, so the diff is never computed over a different session.
 */
export function shapeOfRearranged(before: OccurrenceSession, after: OccurrenceSession): PlayedShape | null {
  if (!sameItems(before, after)) return null;
  // Each original move's step, by name, with how many of its sets have been placed so far. Step
  // ids are numbered the way deriveWalkthrough numbers them: a circuit block is one step, a
  // straight block one step per item, in order.
  const byName = new Map<string, { stepId: string; sets: number; placed: number }[]>();
  const circuitOf = new Map<string, string>(); // a move inside an original circuit block → that step
  let id = 0;
  for (const b of before.blocks) {
    const its = b.items ?? [];
    if (its.length === 0) continue;
    if (b.mode === 'circuit') {
      id += 1;
      for (const it of its) circuitOf.set(key(it.name), `s${id}`);
      continue;
    }
    for (const it of its) {
      id += 1;
      const list = byName.get(key(it.name)) ?? [];
      list.push({ stepId: `s${id}`, sets: setsOf(it), placed: 0 });
      byName.set(key(it.name), list);
    }
  }

  const take = (name: string, n: number): Turn[] | null => {
    const list = byName.get(key(name));
    if (!list) return null;
    const out: Turn[] = [];
    for (let i = 0; i < n; i++) {
      const entry = list.find((e) => e.placed < e.sets);
      if (!entry) return null;
      out.push({ stepId: entry.stepId, set: entry.placed });
      entry.placed += 1;
    }
    return out;
  };

  const shape: PlayedGroup[] = [];
  let next = 1;
  const seenCircuits = new Set<string>();
  for (const b of after.blocks) {
    const its = b.items ?? [];
    if (its.length === 0) continue;
    const original = its.every((it) => circuitOf.has(key(it.name)))
      ? circuitOf.get(key(its[0]?.name ?? ''))
      : undefined;
    if (original && its.every((it) => circuitOf.get(key(it.name)) === original)) {
      if (!seenCircuits.has(original)) shape.push({ id: `g${next++}`, turns: [{ stepId: original, set: 0 }] });
      seenCircuits.add(original);
      continue;
    }
    if (b.mode === 'circuit' && its.length > 1) {
      const perItem = its.map((it) => take(it.name, setsOf(it)));
      if (perItem.some((t) => t === null)) return null;
      const rounds = Math.max(...perItem.map((t) => t?.length ?? 0));
      const turns: Turn[] = [];
      for (let r = 0; r < rounds; r++) for (const t of perItem) if (t?.[r]) turns.push(t[r] as Turn);
      shape.push({ id: `g${next++}`, turns, mode: 'alternate' });
      continue;
    }
    for (const it of its) {
      const turns = take(it.name, setsOf(it));
      if (!turns) return null;
      shape.push({ id: `g${next++}`, turns });
    }
  }
  return shape;
}
