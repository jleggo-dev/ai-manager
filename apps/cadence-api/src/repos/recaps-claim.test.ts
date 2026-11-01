/**
 * The weekly fact review's run guard against the real table (0062's `recaps.fact_reviewed_at`):
 * the first claim of a recap week wins, a second claim of the same week loses, another week inside
 * the gap loses, and nothing is claimed without a recap row. Red until 0062 is applied.
 *
 * Same harness as follow-ups.test.ts: skips with no Cadence DB env, lazy imports, a per-process
 * synthetic user, deleted after.
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

const USER = testUserId('f0a3');
const OTHER = testUserId('f0a4');
const W1 = '2026-10-19';
const W2 = '2026-10-26';
const FACTS = { sessions: { kept: 3, scheduled: 4 }, meals: { logged: 10, total: 21 }, weigh_in: null };

let sql: (typeof import('../db/sql.ts'))['sql'];
let repo: typeof import('./recaps.ts');
let ensureUser: (typeof import('./users.ts'))['ensureUser'];

d('recaps — the fact review claim (DB)', () => {
  beforeAll(async () => {
    ({ sql } = await import('../db/sql.ts'));
    repo = await import('./recaps.ts');
    ({ ensureUser } = await import('./users.ts'));
    await ensureUser(USER, 'zzq-recaps-claim@cadence.test');
    await ensureUser(OTHER, 'zzq-recaps-claim-other@cadence.test');
  }, 30_000);

  beforeEach(async () => {
    await sql`delete from cadence.recaps where user_id in (${USER}, ${OTHER})`;
    for (const week of [W1, W2]) {
      await repo.upsertRecap(USER, { weekStart: week, facts: FACTS, factsLine: 'zzq', detour: false });
    }
    await repo.upsertRecap(OTHER, { weekStart: W2, facts: FACTS, factsLine: 'zzq', detour: false });
  });

  afterAll(async () => {
    await sql`delete from cadence.recaps where user_id in (${USER}, ${OTHER})`;
    await sql`delete from cadence.users where id in (${USER}, ${OTHER})`;
    await sql.end({ timeout: 5 });
  }, 30_000);

  it('the first claim of a week wins; a re-confirm of the same week does not', async () => {
    expect(await repo.claimFactReviewWeek(USER, W2, 5)).toBe(true);
    expect(await repo.claimFactReviewWeek(USER, W2, 5)).toBe(false);
  });

  it('another week inside the gap is not claimed; with no gap it is', async () => {
    expect(await repo.claimFactReviewWeek(USER, W2, 5)).toBe(true);
    expect(await repo.claimFactReviewWeek(USER, W1, 5)).toBe(false);
    expect(await repo.claimFactReviewWeek(USER, W1, 0)).toBe(true);
  });

  it('a re-confirm keeps the mark — the upsert never clears it', async () => {
    expect(await repo.claimFactReviewWeek(USER, W2, 5)).toBe(true);
    await repo.upsertRecap(USER, { weekStart: W2, facts: FACTS, factsLine: 'zzq again', detour: false });
    expect(await repo.claimFactReviewWeek(USER, W2, 0)).toBe(false);
  });

  it('no recap row, nothing claimed; and one person never claims for another', async () => {
    expect(await repo.claimFactReviewWeek(USER, '2026-09-07', 0)).toBe(false);
    expect(await repo.claimFactReviewWeek(USER, W2, 5)).toBe(true);
    expect(await repo.claimFactReviewWeek(OTHER, W2, 5)).toBe(true);
  });

  it('two claims racing on one week: exactly one wins', async () => {
    const results = await Promise.all([repo.claimFactReviewWeek(USER, W2, 5), repo.claimFactReviewWeek(USER, W2, 5)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});
