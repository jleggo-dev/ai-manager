/**
 * A23 §metrics — what does the same food cost the second time you log it?
 *
 * MANUAL, READ-ONLY, NOT CI. Run it against real logged data before the ledger lands and again
 * after it has been live a while. It answers the owner's complaint numerically: "every day the LLM
 * returns nutritional information that changes."
 *
 * Three numbers:
 *   • REPEAT-PRICE VARIANCE — for foods logged more than once, how much the per-unit kcal moves
 *     between logs. This is the trust metric, and the ledger's job is to drive it to zero.
 *   • REPEAT-HIT RATE — share of logged items resolved to a saved food (`items[].food_id`). Rises
 *     as the ledger fills; it is the gate on shrinking `parse_meal` to identification-only.
 *   • LEDGER SHARE — share of meals whose macros came wholly from food rows (`macros.source`).
 *
 * Usage:  npx tsx apps/cadence-api/scripts/food-variance-baseline.ts [--days 90] [--user <uuid>]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

dotenv.config({ path: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../.env') });

const { sql } = await import('../src/db/sql.ts');

interface LogRow {
  user_id: string;
  date: string;
  items: Array<{ name?: string; qty?: number; unit?: string; est?: { kcal?: number }; food_id?: string }>;
  macros: { kcal?: number; source?: string } | null;
  provisional: boolean;
}

function arg(flag: string): string | null {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? (process.argv[i + 1] ?? null) : null;
}

/** Same normalization the resolver uses for matching, minus the stemming. */
function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function pct(n: number, d: number): string {
  return d === 0 ? 'n/a' : `${((n / d) * 100).toFixed(1)}%`;
}

const days = Number(arg('--days') ?? 90);
const onlyUser = arg('--user');

const rows = await sql<LogRow[]>`
  select user_id, date::text as date, items, macros, provisional
  from cadence.nutrition_logs
  where date >= (current_date - ${days}::int)
    ${onlyUser ? sql`and user_id = ${onlyUser}::uuid` : sql``}
  order by date`;

/** One priced occurrence of a named food, normalized to a per-unit kcal so quantities compare. */
interface Occurrence {
  kcal_per_unit: number;
  user_id: string;
  date: string;
  has_food_id: boolean;
}

const groups = new Map<string, Occurrence[]>();
let items = 0;
let itemsWithFoodId = 0;

for (const row of rows) {
  if (row.provisional || !Array.isArray(row.items)) continue;
  for (const item of row.items) {
    if (!item?.name) continue;
    items += 1;
    if (item.food_id) itemsWithFoodId += 1;
    const kcal = item.est?.kcal;
    if (typeof kcal !== 'number' || !(kcal > 0)) continue;
    const qty = typeof item.qty === 'number' && item.qty > 0 ? item.qty : 1;
    // Group per user: two people's "yogurt parfait" are different foods, and the ledger is per user.
    const key = `${row.user_id}|${normalize(item.name)}|${(item.unit ?? '').toLowerCase()}`;
    const list = groups.get(key) ?? [];
    list.push({ kcal_per_unit: kcal / qty, user_id: row.user_id, date: row.date, has_food_id: !!item.food_id });
    groups.set(key, list);
  }
}

interface Repeat {
  key: string;
  n: number;
  cv: number;
  spread: number;
  min: number;
  max: number;
}

const repeats: Repeat[] = [];
for (const [key, occ] of groups) {
  if (occ.length < 2) continue;
  const vals = occ.map((o) => o.kcal_per_unit);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  if (!(mean > 0)) continue;
  const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  repeats.push({ key, n: occ.length, cv: Math.sqrt(variance) / mean, spread: max - min, min, max });
}
repeats.sort((a, b) => b.cv - a.cv);

const meals = rows.filter((r) => !r.provisional && r.macros && Object.keys(r.macros).length > 0);
const ledgerMeals = meals.filter((r) => r.macros?.source === 'ledger');
const stable = repeats.filter((r) => r.cv < 0.01);

console.log(`\n── Food ledger metrics — last ${days} days${onlyUser ? ` (user ${onlyUser})` : ''} ──\n`);
console.log(`logs                 ${rows.length}`);
console.log(`items                ${items}`);
console.log(`repeat groups        ${repeats.length}  (a named food logged 2+ times by one user)\n`);

console.log('REPEAT-PRICE VARIANCE  — the trust metric; the ledger drives this to zero');
console.log(`  median CV          ${(median(repeats.map((r) => r.cv)) * 100).toFixed(1)}%`);
console.log(`  groups priced identically every time  ${stable.length} / ${repeats.length} (${pct(stable.length, repeats.length)})`);

console.log('\nREPEAT-HIT RATE        — items resolved to a saved food');
console.log(`  ${itemsWithFoodId} / ${items}  (${pct(itemsWithFoodId, items)})`);

console.log('\nLEDGER SHARE           — meals priced wholly from food rows');
console.log(`  ${ledgerMeals.length} / ${meals.length}  (${pct(ledgerMeals.length, meals.length)})`);

if (repeats.length) {
  console.log('\nWORST OFFENDERS (per-unit kcal for the same words)');
  for (const r of repeats.slice(0, 10)) {
    const name = r.key.split('|').slice(1).filter(Boolean).join(' / ');
    console.log(
      `  ${(r.cv * 100).toFixed(0).padStart(4)}%  ×${String(r.n).padEnd(3)} ${Math.round(r.min)}–${Math.round(r.max)} kcal   ${name}`,
    );
  }
}
console.log('');

await sql.end({ timeout: 5 });
