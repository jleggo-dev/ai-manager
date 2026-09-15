/**
 * Apply migrations/cadence/0060_plan_edits.sql. Additive + idempotent, safe to re-run.
 * Run: node --import tsx apps/cadence-api/scripts/apply-migration-0060.ts
 *
 * Deploy order is forgiving here, unlike 0058/0059: the one writer (`recordPlanEdit`, called from
 * services/occurrence-edit.ts) and the one reader (`listPlanEdits`, in get_active_plan's batch)
 * are both best-effort, so an API that ships before the table exists loses nothing but the
 * record of edits made in the gap. Apply it before merging all the same.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from '../src/db/sql.ts';

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  await sql.unsafe(readFileSync(path.join(root, 'migrations/cadence/0060_plan_edits.sql'), 'utf8'));

  const cols = await sql<{ column_name: string }[]>`
    select column_name from information_schema.columns
     where table_schema = 'cadence' and table_name = 'plan_edits' order by ordinal_position`;
  console.log('cadence.plan_edits:', cols.length ? cols.map((c) => c.column_name).join(', ') : 'MISSING!');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
