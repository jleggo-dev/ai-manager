/**
 * The pace against the real table: the one place the SQL actually runs, since every route and card
 * test fakes this repo. The number matters as much as the query. A `numeric` column would come back
 * from postgres.js as a string, the client would read that as "no pace", and the slider would
 * quietly forget on every new phone.
 *
 * Same harness as users.ensure.test.ts: skips with no Cadence DB env, lazy imports, a per-process
 * synthetic user, deleted after. The migration check below needs no database, so it always runs.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { testUserId } from '../services/test-user.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
dotenv.config({ path: path.join(repoRoot, 'apps/cadence-api/.env') });

const HAS_DB = !!(process.env.CADENCE_DATABASE_URL || process.env.CADENCE_DB_PASSWORD);
const d = HAS_DB ? describe : describe.skip;

const USER = testUserId('b9a5');
const NOBODY = testUserId('b9a6');

describe('the breath_pace column', () => {
  const dir = path.join(repoRoot, 'migrations/cadence');
  const declaring = readdirSync(dir).filter((f) =>
    /add column[^;]*\bbreath_pace\b/.test(readFileSync(path.join(dir, f), 'utf8')),
  );

  it('is declared by exactly one migration', () => {
    expect(declaring).toEqual(['0066_breath_pace.sql']);
  });

  it('comes back as a number and stays nullable, because null means never set', () => {
    const sqlText = readFileSync(path.join(dir, '0066_breath_pace.sql'), 'utf8');
    expect(sqlText).toMatch(/breath_pace double precision;/);
    expect(sqlText).not.toMatch(/breath_pace[^;]*not null/);
  });
});

d('breath pace repo (DB)', () => {
  let sql: (typeof import('../db/sql.ts'))['sql'];
  let ensureUser: (typeof import('./users.ts'))['ensureUser'];
  let getBreathPace: (typeof import('./breath-pace.ts'))['getBreathPace'];
  let setBreathPace: (typeof import('./breath-pace.ts'))['setBreathPace'];

  beforeAll(async () => {
    ({ sql } = await import('../db/sql.ts'));
    ({ ensureUser } = await import('./users.ts'));
    ({ getBreathPace, setBreathPace } = await import('./breath-pace.ts'));
  }, 30_000);

  beforeEach(async () => {
    await sql`delete from cadence.users where id = ${USER}`;
    await ensureUser(USER, 'zzq-breath-pace@cadence.test');
  });

  afterAll(async () => {
    await sql`delete from cadence.users where id = ${USER}`;
    await sql.end({ timeout: 5 });
  }, 30_000);

  it('reads null until the person sets one', async () => {
    expect(await getBreathPace(USER)).toBeNull();
  });

  it('reads back the exact value, as a number', async () => {
    await setBreathPace(USER, 1.37);
    const pace = await getBreathPace(USER);
    expect(typeof pace).toBe('number');
    expect(pace).toBe(1.37);
  });

  it('a second save replaces the first', async () => {
    await setBreathPace(USER, 1.37);
    await setBreathPace(USER, 0.8);
    expect(await getBreathPace(USER)).toBe(0.8);
  });

  it('someone with no row reads null, and a save for them creates nothing', async () => {
    await setBreathPace(NOBODY, 1.5);
    expect(await getBreathPace(NOBODY)).toBeNull();
  });
});
