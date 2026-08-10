/**
 * Apply migrations/cadence/0029_in_flight_response.sql. Additive + idempotent, safe to re-run.
 * Run: node --import tsx apps/cadence-api/scripts/apply-migration-0029.ts
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from '../src/db/sql.ts';

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const ddl = readFileSync(path.join(root, 'migrations/cadence/0029_in_flight_response.sql'), 'utf8');
  await sql.unsafe(ddl);

  const [col] = await sql<{ ok: boolean }[]>`
    select exists (
      select 1 from information_schema.columns
      where table_schema = 'cadence' and table_name = 'conversations'
        and column_name = 'in_flight_response_id'
    ) as ok`;
  console.log('cadence.conversations.in_flight_response_id:', col?.ok ? 'exists ✓' : '(missing!)');

  // Nullable is the whole design: null means "nothing generating". A NOT NULL here would force the
  // relay to invent a sentinel for the idle case.
  const [nullable] = await sql<{ yes: string }[]>`
    select is_nullable as yes from information_schema.columns
    where table_schema = 'cadence' and table_name = 'conversations' and column_name = 'in_flight_response_id'`;
  console.log('nullable:', nullable?.yes === 'YES' ? 'YES ✓' : `${nullable?.yes} (unexpected!)`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
