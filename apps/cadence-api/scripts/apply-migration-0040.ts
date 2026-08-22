/**
 * Apply migrations/cadence/0040_current_location.sql. Additive + idempotent, safe to re-run.
 * Run: node --import tsx apps/cadence-api/scripts/apply-migration-0040.ts
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from '../src/db/sql.ts';

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const ddl = readFileSync(path.join(root, 'migrations/cadence/0040_current_location.sql'), 'utf8');
  await sql.unsafe(ddl);

  const [col] = await sql<{ n: number }[]>`
    select count(*)::int as n
      from information_schema.columns
     where table_schema = 'cadence' and table_name = 'users' and column_name = 'current_location'`;
  console.log('cadence.users.current_location:', col?.n ? 'exists ✓' : '(missing!)');

  // A row that is home reads null — the correct answer for every row that existed before this ran.
  const [rows] = await sql<{ total: number; away: number }[]>`
    select count(*)::int as total,
           count(current_location)::int as away
      from cadence.users`;
  console.log(`users: ${rows?.total ?? 0} total, ${rows?.away ?? 0} currently away from home`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
