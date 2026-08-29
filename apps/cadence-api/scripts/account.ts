/**
 * Dev account tooling (real auth deferred). Manage the interchangeable scratch test accounts.
 *   list               — show accounts + row counts
 *   seed  <slug|uuid>  — ensure the users row exists
 *   reset <slug|uuid>  — wipe ALL cadence data for the account (keeps the users row; nulls the
 *                        name, empties the baseline) so it can be onboarded fresh
 *   reset-all          — reset every allowlisted scratch account (post-merge cleanup)
 * Run: node --import tsx apps/cadence-api/scripts/account.ts <cmd> [slug]   e.g. reset account-1
 */
import { sql } from '../src/db/sql.ts';
import { cadenceConfig } from '../src/config.ts';
import { ensureUser as seed, resetUserData as reset, DEV_CHILD_TABLES } from '../src/services/dev-reset.ts';

function resolve(slugOrId: string | undefined): string {
  const s = String(slugOrId ?? '').trim().toLowerCase();
  if (!s) throw new Error('account slug or uuid required');
  if (cadenceConfig.devAccounts[s]) return cadenceConfig.devAccounts[s];
  if (/^[0-9a-f-]{36}$/.test(s)) return s;
  throw new Error(`unknown account "${slugOrId}" (known: ${Object.keys(cadenceConfig.devAccounts).join(', ')})`);
}

/**
 * Delete the per-process users the DB-backed suites create (`services/test-user.ts`).
 *
 * Those ids carry the pid so two concurrent runs cannot wipe each other's rows, which means each
 * run leaves one user behind and `afterAll` cannot be relied on — a crashed or killed run never
 * gets there. The four scratch accounts above are RESET (kept, emptied) because a person signs in
 * as them; these are created per run and nobody owns them, so they are removed outright.
 *
 * Matched on the synthetic prefix plus the four-hex suite marker, which is narrower than the
 * scratch namespace and cannot touch a real auth user.
 */
async function sweepSuiteUsers(): Promise<void> {
  const rows = await sql<{ id: string }[]>`
    select id::text from cadence.users
     where id::text ~ '^00000000-0000-4000-a000-[0-9a-f]{4}[0-9a-f]{8}$'
       and id::text !~ '^00000000-0000-4000-a000-0000000'`;
  for (const { id } of rows) {
    await reset(id);
    await sql`delete from cadence.users where id = ${id}`;
  }
  console.log(`✓ swept ${rows.length} per-process suite user(s)`);
}

async function rowCounts(id: string): Promise<{ total: number; per: Record<string, number> }> {
  const per: Record<string, number> = {};
  let total = 0;
  for (const t of DEV_CHILD_TABLES) {
    const [r] = await sql<{ n: number }[]>`select count(*)::int as n from cadence.${sql(t)} where user_id = ${id}`;
    const n = r?.n ?? 0;
    if (n > 0) per[t] = n;
    total += n;
  }
  return { total, per };
}

async function main() {
  const [cmd, arg] = process.argv.slice(2);
  if (cmd === 'list' || !cmd) {
    for (const [slug, id] of Object.entries(cadenceConfig.devAccounts)) {
      const [u] = await sql<{ name: string | null }[]>`select name from cadence.users where id = ${id}`;
      const { total, per } = await rowCounts(id);
      console.log(`${slug.padEnd(12)} ${id}  name=${u?.name ?? '(none)'}  rows=${total}  ${JSON.stringify(per)}`);
    }
  } else if (cmd === 'seed') {
    const id = resolve(arg);
    await seed(id);
    console.log(`✓ seeded ${arg} → ${id}`);
  } else if (cmd === 'reset') {
    const id = resolve(arg);
    await reset(id);
    console.log(`✓ reset ${arg} → ${id} (all data cleared, name + baseline reset — ready for fresh onboarding)`);
  } else if (cmd === 'reset-all') {
    for (const [slug, id] of Object.entries(cadenceConfig.devAccounts)) {
      await reset(id);
      console.log(`✓ reset ${slug} → ${id}`);
    }
    await sweepSuiteUsers();
    console.log('✓ reset-all complete (scratch accounts only — not real auth users)');
  } else {
    console.log('usage: account.ts <list|seed|reset|reset-all> [slug|uuid]');
  }
  await sql.end();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
