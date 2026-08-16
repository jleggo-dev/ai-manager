/**
 * Apply migrations/cadence/0035_notify_on_reply.sql. Additive + idempotent, safe to re-run.
 * Run: node --import tsx apps/cadence-api/scripts/apply-migration-0035.ts
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from '../src/db/sql.ts';

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const ddl = readFileSync(path.join(root, 'migrations/cadence/0035_notify_on_reply.sql'), 'utf8');
  await sql.unsafe(ddl);

  const [col] = await sql<{ ok: boolean }[]>`
    select exists (
      select 1 from information_schema.columns
      where table_schema = 'cadence' and table_name = 'conversations' and column_name = 'notify_on_reply'
    ) as ok`;
  console.log('conversations.notify_on_reply:', col?.ok ? 'exists ✓' : '(missing!)');
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
