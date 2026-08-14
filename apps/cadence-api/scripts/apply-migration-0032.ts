/**
 * Apply migrations/cadence/0032_users_pack_touch.sql. Additive + idempotent, safe to re-run.
 * Run: node --import tsx apps/cadence-api/scripts/apply-migration-0032.ts
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from '../src/db/sql.ts';

async function main() {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
  const ddl = readFileSync(path.join(root, 'migrations/cadence/0032_users_pack_touch.sql'), 'utf8');
  await sql.unsafe(ddl);

  const [trg] = await sql<{ ok: boolean }[]>`
    select exists (
      select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'cadence' and c.relname = 'users' and t.tgname = 'pack_touch'
    ) as ok`;
  console.log('users.pack_touch trigger:', trg?.ok ? 'exists ✓' : '(missing!)');

  // Prove the WHEN clause both fires and stays quiet: a baseline change must move the watermark;
  // a pending_plan-only change must not (or pack reuse dies).
  const [probe] = await sql<{ id: string }[]>`
    select id from cadence.users order by created_at limit 1`;
  if (probe) {
    const before = await sql<{ t: Date }[]>`select pack_touched_at as t from cadence.users where id = ${probe.id}`;
    await sql`update cadence.users set baseline = baseline || '{"__probe": 1}'::jsonb where id = ${probe.id}`;
    const mid = await sql<{ t: Date }[]>`select pack_touched_at as t from cadence.users where id = ${probe.id}`;
    await sql`update cadence.users set baseline = baseline - '__probe' where id = ${probe.id}`;
    const fired = mid[0]!.t.getTime() > before[0]!.t.getTime();
    console.log('baseline write moves watermark:', fired ? 'yes ✓' : 'NO (broken!)');
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
