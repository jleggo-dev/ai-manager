/**
 * `ensureUser` against the real table: an account that started anonymous (email '') gets its
 * email once it signs in, and a set email is never overwritten. The 2026-10-29 bug — the owner's
 * real account had a blank email for two months because the write was insert-only.
 *
 * Same harness as context-pack-touch.test.ts: skips with no Cadence DB env, lazy imports, a
 * per-process synthetic user, deleted after.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { testUserId } from '../services/test-user.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
dotenv.config({ path: path.join(repoRoot, 'apps/cadence-api/.env') });

const HAS_DB = !!(process.env.CADENCE_DATABASE_URL || process.env.CADENCE_DB_PASSWORD);
const d = HAS_DB ? describe : describe.skip;

const USER = testUserId('e3a1');

let sql: (typeof import('../db/sql.ts'))['sql'];
let ensureUser: (typeof import('./users.ts'))['ensureUser'];

async function emailOnFile(): Promise<string | null> {
  const [row] = await sql<{ email: string | null }[]>`select email from cadence.users where id = ${USER}`;
  return row?.email ?? null;
}

d('ensureUser — email (DB)', () => {
  beforeAll(async () => {
    ({ sql } = await import('../db/sql.ts'));
    ({ ensureUser } = await import('./users.ts'));
  }, 30_000);

  beforeEach(async () => {
    await sql`delete from cadence.users where id = ${USER}`;
  });

  afterAll(async () => {
    await sql`delete from cadence.users where id = ${USER}`;
    await sql.end({ timeout: 5 });
  }, 30_000);

  it('an anonymous start gets its email when the account signs in', async () => {
    await ensureUser(USER, '');
    expect(await emailOnFile()).toBe('');
    await ensureUser(USER, 'zzq-signed-in@cadence.test');
    expect(await emailOnFile()).toBe('zzq-signed-in@cadence.test');
  });

  it('a null email is filled too', async () => {
    await ensureUser(USER, null);
    await ensureUser(USER, 'zzq-later@cadence.test');
    expect(await emailOnFile()).toBe('zzq-later@cadence.test');
  });

  it('a set email is never overwritten, and a blank never clears one', async () => {
    await ensureUser(USER, 'zzq-first@cadence.test');
    await ensureUser(USER, 'zzq-second@cadence.test');
    await ensureUser(USER, '');
    await ensureUser(USER, null);
    expect(await emailOnFile()).toBe('zzq-first@cadence.test');
  });
});
