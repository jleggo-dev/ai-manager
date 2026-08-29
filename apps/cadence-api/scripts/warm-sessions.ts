/**
 * Warm the session cache for one user, from a process that stays alive.
 *
 *   node --import tsx apps/cadence-api/scripts/warm-sessions.ts <email> [days]
 *
 * Exists because the in-request warm (`prefetchImminentSessions`) was dead in production from the
 * day it shipped — Vercel freezes the instance at res.json, killing every fire-and-forget — so any
 * week materialized under that regime sits fully cold, and each tap pays the ~30s generation live.
 * The `runInBackground`/waitUntil fix (same PR as this script) heals a few sessions per plan open;
 * this script is the bulk version: run it locally once for an account and the whole window is warm.
 *
 * Safe to re-run (a warm row is one SELECT, no generation), bounded to the same concurrency the
 * prod path uses, and it writes nothing but the session cache rows the product itself writes.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as dotenv } from 'dotenv';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
dotenv({ path: path.join(root, 'apps/cadence-api/.env') });

const [, , email, daysArg] = process.argv;
if (!email) {
  console.error('usage: node --import tsx apps/cadence-api/scripts/warm-sessions.ts <email> [days]');
  process.exit(1);
}

const { sql } = await import('../src/db/sql.ts');
const { prefetchImminentSessions } = await import('../src/services/session-generate.ts');

const rows = await sql<{ id: string }[]>`
  select cu.id from auth.users au join cadence.users cu on cu.id = au.id where au.email = ${email}
`;
if (!rows.length) {
  console.error(`no cadence user for ${email}`);
  process.exit(1);
}
const userId = rows[0]!.id;
const days = daysArg ? Number(daysArg) : undefined;

const before = await sql<{ n: string }[]>`
  select count(*) as n from cadence.occurrences
  where user_id = ${userId} and status = 'pending' and session is null
    and date >= current_date and date <= current_date + 7
`;
console.log(`[warm] ${email} — ${before[0]?.n ?? '?'} cold pending occurrences in the next 7 days; warming…`);

const started = Date.now();
await prefetchImminentSessions(userId, days);

const after = await sql<{ n: string }[]>`
  select count(*) as n from cadence.occurrences
  where user_id = ${userId} and status = 'pending' and session is null
    and date >= current_date and date <= current_date + 7
`;
console.log(`[warm] done in ${Math.round((Date.now() - started) / 1000)}s — cold rows now: ${after[0]?.n ?? '?'}`);
process.exit(0);
