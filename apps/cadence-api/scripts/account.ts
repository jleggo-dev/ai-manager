/**
 * Dev account tooling (real auth deferred). Manage the interchangeable scratch test accounts.
 *   list               — show accounts + row counts
 *   seed  <slug|uuid>  — ensure the users row exists
 *   reset <slug|uuid>  — wipe ALL cadence data for the account (keeps the users row; nulls the
 *                        name, empties the baseline) so it can be onboarded fresh
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

async function rowCounts(id: string): Promise<{ total: number; per: Record<string, number> }> {
  const per: Record<string, number> = {};
  let total = 0;
  for (const t of DEV_CHILD_TABLES) {
    const [r] = await sql<{ n: number }[]>`select count(*)::int as n from cadence.${sql(t)} where user_id = ${id}`;
    if (r.n > 0) per[t] = r.n;
    total += r.n;
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
  } else {
    console.log('usage: account.ts <list|seed|reset> [slug|uuid]');
  }
  await sql.end();
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
