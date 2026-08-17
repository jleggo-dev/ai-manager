/**
 * P3 — the reuse decision against the REAL trigger watermark (migration 0022), through the app's
 * own read (`getFreshContextPack`). The mock suite proves the service branches; this proves the
 * database tells it the truth:
 *
 *   - a dossier write (goal insert, journal secret toggle, occurrence status flip) invalidates
 *   - a session-CACHE write does NOT (the occurrences WHEN clause — without it, every plan open
 *     would kill every pack and reuse would never hit)
 *   - intent and expiry are honoured
 *
 * Same harness rules as plan-commit.test.ts: skips cleanly with no Cadence DB env; lazy imports so
 * config.ts never throws at import in CI; a dedicated synthetic user, wiped after.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { testUserId } from './test-user.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
dotenv.config({ path: path.join(repoRoot, 'apps/cadence-api/.env') });

const HAS_DB = !!(process.env.CADENCE_DATABASE_URL || process.env.CADENCE_DB_PASSWORD);
const d = HAS_DB ? describe : describe.skip;

const USER = testUserId('a107');

let sql: (typeof import('../db/sql.ts'))['sql'];
let insertContextPack: (typeof import('../repos/context-pack.ts'))['insertContextPack'];
let getFreshContextPack: (typeof import('../repos/context-pack.ts'))['getFreshContextPack'];
let resetUserData: (typeof import('./dev-reset.ts'))['resetUserData'];

let activityId: string;
let occurrenceId: string;
let entryId: string;

/** Pull the watermark safely behind the pack's built_at, so the next insert is a guaranteed HIT
 *  and only the write under test can turn it into a miss. */
async function backdateWatermark(): Promise<void> {
  await sql`update cadence.users set pack_touched_at = now() - interval '1 minute',
            updated_at = now() - interval '1 minute' where id = ${USER}`;
}

async function freshPack(intent = 'ongoing'): Promise<void> {
  await backdateWatermark();
  const id = await insertContextPack({
    userId: USER,
    topic: null,
    sections: { summary: 's', mode: 'test', intent },
    rendered: 'DOSSIER',
    provenance: [],
    tokenEstimate: 1,
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  });
  expect(id).toBeTruthy();
}

d('P3 — the trigger watermark tells the reuse read the truth (DB)', () => {
  beforeAll(async () => {
    ({ sql } = await import('../db/sql.ts'));
    ({ insertContextPack, getFreshContextPack } = await import('../repos/context-pack.ts'));
    ({ resetUserData } = await import('./dev-reset.ts'));
    await sql`insert into cadence.users (id) values (${USER}) on conflict (id) do nothing`;
    await resetUserData(USER);
    // A minimal plan → activity → occurrence spine, plus a journal entry, for the write cases.
    const [plan] = await sql`insert into cadence.plans (user_id, goal_ids, status)
      values (${USER}, '{}', 'active') returning plan_id`;
    const [act] = await sql`insert into cadence.activities (plan_id, user_id, title, kind, schedule)
      values (${(plan as { plan_id: string }).plan_id}, ${USER}, 'probe', 'user', '{}') returning activity_id`;
    activityId = (act as { activity_id: string }).activity_id;
    const [occ] = await sql`insert into cadence.occurrences (activity_id, user_id, date)
      values (${activityId}, ${USER}, current_date) returning occurrence_id`;
    occurrenceId = (occ as { occurrence_id: string }).occurrence_id;
    const [entry] = await sql`insert into cadence.journal_entries (user_id, body, secret, mode)
      values (${USER}, 'probe words', false, 'typed') returning entry_id`;
    entryId = (entry as { entry_id: string }).entry_id;
  }, 30_000);

  afterAll(async () => {
    await resetUserData(USER);
    await sql`delete from cadence.users where id = ${USER}`;
    await sql.end({ timeout: 5 });
  }, 30_000);

  it('a fresh, untouched pack is served', async () => {
    await freshPack();
    const hit = await getFreshContextPack(USER, null, 'ongoing');
    expect(hit?.rendered).toBe('DOSSIER');
  });

  it('a goal write invalidates', async () => {
    await freshPack();
    await sql`insert into cadence.goals (user_id, title, area, type, measure, timeframe, status, linked_equipment, source)
      values (${USER}, 'new goal', 'movement', 'recurring', '{}', '{}', 'captured', '{}', 'manual')`;
    expect(await getFreshContextPack(USER, null, 'ongoing')).toBeNull();
  });

  it('marking a journal entry secret invalidates — the pack must forget it', async () => {
    await freshPack();
    await sql`update cadence.journal_entries set secret = true where entry_id = ${entryId}`;
    expect(await getFreshContextPack(USER, null, 'ongoing')).toBeNull();
  });

  it('an occurrence status flip invalidates', async () => {
    await freshPack();
    await sql`update cadence.occurrences set status = 'done' where occurrence_id = ${occurrenceId}`;
    expect(await getFreshContextPack(USER, null, 'ongoing')).toBeNull();
  });

  it('a session-CACHE write does NOT invalidate — plan opens must not churn packs', async () => {
    await freshPack();
    await sql`update cadence.occurrences set session = '{"cached":true}' where occurrence_id = ${occurrenceId}`;
    const hit = await getFreshContextPack(USER, null, 'ongoing');
    expect(hit?.rendered).toBe('DOSSIER');
  });

  it('intent must match — a disrupted session never reuses an ongoing framing', async () => {
    await freshPack('ongoing');
    expect(await getFreshContextPack(USER, null, 'disrupted')).toBeNull();
  });

  it('an expired pack is never served, however untouched', async () => {
    await backdateWatermark();
    await insertContextPack({
      userId: USER,
      topic: null,
      sections: { summary: 's', mode: 'test', intent: 'ongoing' },
      rendered: 'EXPIRED',
      provenance: [],
      tokenEstimate: 1,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    // The still-live DOSSIER pack from the cache-write test may hit; assert we never get EXPIRED.
    const hit = await getFreshContextPack(USER, null, 'ongoing');
    expect(hit?.rendered ?? '').not.toBe('EXPIRED');
  });
});
