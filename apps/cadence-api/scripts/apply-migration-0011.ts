/**
 * Apply migrations/cadence/0011_goal_events.sql. Additive + idempotent, safe to re-run.
 * Run: node --import tsx apps/cadence-api/scripts/apply-migration-0011.ts
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from '../src/db/sql.ts';

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const ddl = readFileSync(path.join(root, 'migrations/cadence/0011_goal_events.sql'), 'utf8');
  await sql.unsafe(ddl);
  const [t] = await sql<{ ok: boolean }[]>`
    select exists (
      select 1 from information_schema.tables where table_schema = 'cadence' and table_name = 'goal_events'
    ) as ok`;
  console.log('cadence.goal_events:', t?.ok ? 'exists ✓' : '(missing!)');
  await sql.end();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
