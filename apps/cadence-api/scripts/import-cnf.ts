/**
 * Bulk-import Health Canada's Canadian Nutrient File into cadence.foods as shared rows.
 *
 * Owner ruling 2026-08-23: "bulk-import it all." The API is dump-shaped — no search endpoint —
 * so this is a corpus, not a rung: three HTTP calls, ~5,690 foods with full lab panels, landing
 * in the FIRST rung (local search) at zero runtime latency and zero availability dependency.
 * Idempotent on cnf_id; re-running refreshes in place.
 *
 *     npx tsx scripts/import-cnf.ts [--cache <dir>]
 *
 * --cache reuses previously downloaded dumps (the nutrient dump is ~86 MB) instead of re-fetching.
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { sql, json } from '../src/db/sql.ts';
import { mapCnfFood, type CnfFoodRow, type CnfNutrientRow, type CnfServingRow } from '../src/services/food-sources/cnf-map.ts';
import { nutritionTier } from '../src/services/food-sources/completeness.ts';

const BASE = 'https://food-nutrition.canada.ca/api/canadian-nutrient-file';
const BATCH = 200;

async function loadDump<T>(cacheDir: string | null, file: string, url: string): Promise<T> {
  if (cacheDir) {
    const p = path.join(cacheDir, file);
    if (existsSync(p)) {
      console.log(`using cached ${file}`);
      return JSON.parse(readFileSync(p, 'utf8')) as T;
    }
  }
  console.log(`fetching ${url} …`);
  const res = await fetch(url, { headers: { 'User-Agent': 'cadence-cnf-import' } });
  if (!res.ok) throw new Error(`CNF fetch failed: HTTP ${res.status} for ${url}`);
  return (await res.json()) as T;
}

const cacheIdx = process.argv.indexOf('--cache');
const cacheDir = cacheIdx >= 0 ? (process.argv[cacheIdx + 1] ?? null) : null;

const [foods, amounts, servings] = await Promise.all([
  loadDump<CnfFoodRow[]>(cacheDir, 'cnf-foods.json', `${BASE}/food/?lang=en&type=json`),
  loadDump<CnfNutrientRow[]>(cacheDir, 'cnf-amounts.json', `${BASE}/nutrientamount/?lang=en&type=json`),
  loadDump<CnfServingRow[]>(cacheDir, 'cnf-servings.json', `${BASE}/servingsize/?lang=en&type=json`),
]);
console.log(`dumps: ${foods.length} foods · ${amounts.length} nutrient rows · ${servings.length} serving rows`);

const amountsByCode = new Map<number, CnfNutrientRow[]>();
for (const r of amounts) {
  const list = amountsByCode.get(r.food_code);
  if (list) list.push(r);
  else amountsByCode.set(r.food_code, [r]);
}
const servingsByCode = new Map<number, CnfServingRow[]>();
for (const r of servings) {
  const list = servingsByCode.get(r.food_code);
  if (list) list.push(r);
  else servingsByCode.set(r.food_code, [r]);
}

const mapped: ReturnType<typeof mapCnfFood>[] = [];
const tiers: Record<string, number> = {};
let dropped = 0;
for (const food of foods) {
  const m = mapCnfFood(food, amountsByCode.get(food.food_code) ?? [], servingsByCode.get(food.food_code) ?? []);
  if (!m) {
    dropped++;
    continue;
  }
  const tier = nutritionTier(m.macros_per_base);
  tiers[tier] = (tiers[tier] ?? 0) + 1;
  // 'unusable' rows (a handful of CNF entries carry no energy) stay OUT of the ledger — a food
  // worth nothing silently deflates any meal it lands in.
  if (tier === 'unusable') {
    dropped++;
    continue;
  }
  mapped.push(m);
}
console.log(`mapped ${mapped.length} · dropped ${dropped} · tiers ${JSON.stringify(tiers)}`);

let written = 0;
for (let i = 0; i < mapped.length; i += BATCH) {
  const batch = mapped.slice(i, i + BATCH).map((m) => ({
    cnf_id: m!.cnf_id,
    name: m!.name,
    macros: m!.macros_per_base,
    servings: m!.servings,
    default_serving: m!.default_serving,
  }));
  await sql`
    insert into cadence.foods (
      owner_user_id, visibility, name, brand, source, base_unit,
      macros_per_base, servings, default_serving, confidence, cnf_id
    )
    select null, 'shared', r.name, null, 'cnf', 'g', r.macros, r.servings, r.default_serving, 1, r.cnf_id
    from jsonb_to_recordset(${json(batch)})
      as r(cnf_id int, name text, macros jsonb, servings jsonb, default_serving int)
    on conflict (cnf_id) do update set
      name = excluded.name,
      macros_per_base = excluded.macros_per_base,
      servings = excluded.servings,
      default_serving = excluded.default_serving,
      source = 'cnf',
      visibility = 'shared',
      owner_user_id = null`;
  written += batch.length;
  if (written % 1000 < BATCH) console.log(`  upserted ${written}/${mapped.length}`);
}

const [count] = await sql<{ n: number }[]>`select count(*)::int as n from cadence.foods where source = 'cnf'`;
console.log(`done — ${written} upserted this run, ${count?.n} cnf rows in the ledger`);
await sql.end();
