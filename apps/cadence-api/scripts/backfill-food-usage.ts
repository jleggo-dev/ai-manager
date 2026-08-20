/**
 * Backfill Foods + food_usage for meals logged BEFORE the capture path remembered them.
 *
 * Until this shipped, anything logged by words or photo wrote a `nutrition_logs` row and stopped:
 * no Food, no usage row, nothing for search or recents to find. New meals now promote themselves
 * (services/food-promote.ts) — this walks what is already on file so someone who logged a latte
 * last week can find it today instead of having to log it a second time first.
 *
 * No AI and no new numbers: it reuses the estimates already stored on each row. Re-runnable —
 * items that already carry a food_id are skipped, so a second run is close to a no-op.
 *
 * Oldest first ON PURPOSE: `touchFoodUsage` stamps `last_used_at = now()`, so processing in meal
 * order leaves recents ordered the way the user actually ate.
 *
 * Run: node --import tsx apps/cadence-api/scripts/backfill-food-usage.ts <user-id-or-slug> [days]
 *      (slug 'account-1' / 'account-2' accepted; days defaults to 90)
 */
import { cadenceConfig } from '../src/config.ts';
import { sql } from '../src/db/sql.ts';
import { listNutritionLogs } from '../src/repos/nutrition.ts';
import { promoteLoggedFoods } from '../src/services/food-promote.ts';

const arg = process.argv[2];
if (!arg) {
  console.error('usage: backfill-food-usage.ts <user-id-or-slug> [days]');
  process.exit(1);
}
const userId = cadenceConfig.devAccounts[arg] ?? arg;
const days = Math.min(3650, Math.max(1, Number(process.argv[3]) || 90));

const to = new Date().toISOString().slice(0, 10);
const from = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);

// listNutritionLogs is newest-first; walk it backwards so usage lands in the order it happened.
const logs = (await listNutritionLogs(userId, from, to)).reverse();
console.log(`walking ${logs.length} meal(s) for ${arg} over the last ${days} day(s)…`);

let created = 0;
let matched = 0;
let touched = 0;
for (const log of logs) {
  try {
    const out = await promoteLoggedFoods(userId, log);
    if (out.created + out.matched === 0) continue;
    created += out.created;
    matched += out.matched;
    touched += 1;
    console.log(`  ${log.date} ${log.meal}: +${out.created} new, ${out.matched} already yours`);
  } catch (e) {
    console.warn(`  ${log.date} ${log.meal}: skipped —`, e instanceof Error ? e.message : e);
  }
}

console.log(`done: ${touched} meal(s) linked, ${created} food(s) created, ${matched} matched to one you had.`);
await sql.end();
process.exit(0);
