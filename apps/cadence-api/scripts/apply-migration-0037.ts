/**
 * Apply migrations/cadence/0037_water_logs.sql. Additive + idempotent, safe to re-run.
 * Run: node --import tsx apps/cadence-api/scripts/apply-migration-0037.ts
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from '../src/db/sql.ts';

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const ddl = readFileSync(path.join(root, 'migrations/cadence/0037_water_logs.sql'), 'utf8');
  await sql.unsafe(ddl);

  const [tbl] = await sql<{ n: number }[]>`
    select count(*)::int as n
      from information_schema.tables
     where table_schema = 'cadence' and table_name = 'water_logs'`;
  console.log('cadence.water_logs:', tbl?.n ? 'exists ✓' : '(missing!)');

  const [idx] = await sql<{ n: number }[]>`
    select count(*)::int as n from pg_indexes
     where schemaname = 'cadence' and indexname = 'water_logs_user_date'`;
  console.log('water_logs_user_date index:', idx?.n ? 'exists ✓' : '(missing!)');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
