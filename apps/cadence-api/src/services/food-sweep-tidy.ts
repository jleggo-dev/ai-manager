/**
 * The retro tidy (S4) — opt-in, reversible, and blind to numbers.
 *
 * Accepting a sweep recipe offers to re-read the week behind you: flat logs that match the
 * recipe's members get a bracket (a MealPart tagged source:'sweep') around those members, and
 * NOTHING else changes — same items, same est, same macros. A log with an extra item keeps it
 * loose, outside the bracket. A log the user already bracketed is theirs and is left alone.
 * Revert takes every sweep-tagged part back off and touches no user part.
 */
import type { MealItem, MealPart } from '@cadence/shared';
import { getPendingFoodSweep } from '../repos/users.ts';
import { getSweepLog, listLogsWithSweepParts, writeLogPartsAndItems } from '../repos/nutrition-sweep.ts';
import type { StoredFoodSweep, TidyReadyEntry } from './food-sweep.ts';

/** Bracket one log for one committed proposal. False = left alone (already tidied, already
 *  bracketed by the user, a member no longer loose, or the log is gone). */
async function bracketLog(userId: string, logId: string, entry: TidyReadyEntry): Promise<boolean> {
  const log = await getSweepLog(userId, logId);
  if (!log) return false;
  const partKey = `sweep_${entry.proposal_id}`;
  if (log.parts.some((p) => p.key === partKey)) return false; // already tidied — calling twice is safe

  // Every member must still be present as a LOOSE item. An item already inside any bracket —
  // the user's or an earlier sweep's — means this meal's grouping is spoken for.
  const memberIndexes = new Set<number>();
  const found = new Set<string>();
  log.items.forEach((item, i) => {
    if (item.part || !item.food_id) return;
    if (entry.member_food_ids.includes(item.food_id) && !found.has(item.food_id)) {
      found.add(item.food_id);
      memberIndexes.add(i);
    }
  });
  if (found.size !== entry.member_food_ids.length) return false;

  // The bracket: member items point at the new part; extra items stay loose outside it.
  // est and macros are not read, not rewritten, not recomputed — grouping changes no numbers.
  const items = log.items.map((item, i) => (memberIndexes.has(i) ? { ...item, part: partKey } : item));
  const part: MealPart = {
    key: partKey,
    name: entry.name,
    recipe_id: entry.recipe_id,
    yield_servings: entry.yield_servings,
    servings_logged: 1,
    source: 'sweep',
  };
  await writeLogPartsAndItems(userId, logId, [...log.parts, part], items);
  return true;
}

/** Apply the tidy for the chosen committed proposals. Returns how many logs got a bracket. */
export async function tidyApply(userId: string, proposalIds: string[]): Promise<{ tidied: number }> {
  const stored = (await getPendingFoodSweep(userId)) as StoredFoodSweep | null;
  const entries = (stored?.tidy_ready ?? []).filter((t) => proposalIds.includes(t.proposal_id));
  let tidied = 0;
  for (const entry of entries) {
    for (const logId of entry.tidy_log_ids) {
      if (await bracketLog(userId, logId, entry)) tidied += 1;
    }
  }
  return { tidied };
}

function withoutPartRef(item: MealItem): MealItem {
  const { part: _dropped, ...rest } = item;
  return rest;
}

/** Take every sweep-tagged part back off, across all the user's logs. User parts stay put. */
export async function tidyRevert(userId: string): Promise<{ reverted: number }> {
  const logs = await listLogsWithSweepParts(userId);
  let reverted = 0;
  for (const log of logs) {
    const sweepKeys = new Set(log.parts.filter((p) => p.source === 'sweep').map((p) => p.key));
    if (sweepKeys.size === 0) continue;
    const parts = log.parts.filter((p) => !sweepKeys.has(p.key));
    const items = log.items.map((item) => (item.part && sweepKeys.has(item.part) ? withoutPartRef(item) : item));
    await writeLogPartsAndItems(userId, log.log_id, parts, items);
    reverted += 1;
  }
  return { reverted };
}
