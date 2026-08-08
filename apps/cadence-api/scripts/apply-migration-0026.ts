/**
 * Apply migrations/cadence/0026_notifications.sql. Additive + idempotent, safe to re-run.
 * Run: node --import tsx apps/cadence-api/scripts/apply-migration-0026.ts
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from '../src/db/sql.ts';

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const ddl = readFileSync(path.join(root, 'migrations/cadence/0026_notifications.sql'), 'utf8');
  await sql.unsafe(ddl);

  for (const table of ['notification_prefs', 'notifications']) {
    const [t] = await sql<{ ok: boolean }[]>`
      select exists (
        select 1 from information_schema.tables
        where table_schema = 'cadence' and table_name = ${table}
      ) as ok`;
    console.log(`cadence.${table}:`, t?.ok ? 'exists ✓' : '(missing!)');
  }

  // THE property this migration exists for. Without a unique index on (user_id, kind, target),
  // two overlapping scheduler ticks both send and the user's phone buzzes twice for one event —
  // unrecallable, and invisible in testing because it needs concurrency to reproduce.
  const [idx] = await sql<{ ok: boolean }[]>`
    select exists (
      select 1 from pg_indexes
      where schemaname = 'cadence' and tablename = 'notifications'
        and indexname = 'notifications_user_kind_target_key'
    ) as ok`;
  console.log('idempotency index (user_id, kind, target):', idx?.ok ? 'present ✓' : '(MISSING — dedupe is off!)');

  // Same reasoning as 0025: weather/notifications are not dossier data, so touching the 0022
  // watermark would invalidate every user's context pack on every send.
  const [trg] = await sql<{ n: number }[]>`
    select count(*)::int n from pg_trigger t
    join pg_class c on c.oid = t.tgrelid join pg_namespace ns on ns.oid = c.relnamespace
    where ns.nspname = 'cadence' and c.relname = 'notifications' and not t.tgisinternal`;
  console.log('pack_touch triggers on notifications:', trg?.n === 0 ? 'none ✓ (correct)' : `${trg?.n} (unexpected!)`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
