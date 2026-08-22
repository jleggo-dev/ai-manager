/**
 * Apply migrations/cadence/0039_food_search_and_rhythm.sql. Additive + idempotent, safe to re-run.
 * Run: node --import tsx apps/cadence-api/scripts/apply-migration-0039.ts
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from '../src/db/sql.ts';

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const ddl = readFileSync(path.join(root, 'migrations/cadence/0039_food_search_and_rhythm.sql'), 'utf8');
  await sql.unsafe(ddl);

  const [ext] = await sql<{ n: number }[]>`
    select count(*)::int as n from pg_extension where extname = 'pg_trgm'`;
  console.log('pg_trgm:', ext?.n ? 'installed ✓' : '(missing!)');

  const [tbl] = await sql<{ n: number }[]>`
    select count(*)::int as n
      from information_schema.tables
     where table_schema = 'cadence' and table_name = 'food_usage_ctx'`;
  console.log('cadence.food_usage_ctx:', tbl?.n ? 'exists ✓' : '(missing!)');

  const idx = await sql<{ indexname: string }[]>`
    select indexname from pg_indexes
     where schemaname = 'cadence'
       and indexname in ('foods_name_trgm_idx', 'foods_brand_trgm_idx',
                         'food_usage_ctx_slot_idx', 'food_usage_ctx_meal_idx')
     order by indexname`;
  console.log('indexes:', idx.map((r) => r.indexname).join(', ') || '(none!)');

  // The search path has to resolve similarity() unqualified for repos/foods.ts to work.
  const [sim] = await sql<{ s: number }[]>`select similarity('greek yogurt', 'yogurt greek')::float as s`;
  console.log('similarity() reachable:', sim ? `✓ (${sim.s.toFixed(2)})` : '(NOT RESOLVABLE)');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
