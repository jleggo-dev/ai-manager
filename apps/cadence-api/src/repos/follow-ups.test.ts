/**
 * The follow-ups repo against the real table (0061): user scoping, the id-prefix close, the
 * ambiguous-prefix refusal, and expiry on the write path. Plus 0062's `source` and `evidence` —
 * the weekly fact review's rows. Those cases stay red until 0062 is applied; the coach's own path
 * is written to work on both sides of it, and its cases say so.
 *
 * Same harness as users.ensure.test.ts: skips with no Cadence DB env, lazy imports, a per-process
 * synthetic user (and a second one for the scoping case), deleted after.
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

const USER = testUserId('f0a1');
const OTHER = testUserId('f0a2');

let sql: (typeof import('../db/sql.ts'))['sql'];
let repo: typeof import('./follow-ups.ts');
let ensureUser: (typeof import('./users.ts'))['ensureUser'];

d('follow-ups repo (DB)', () => {
  beforeAll(async () => {
    ({ sql } = await import('../db/sql.ts'));
    repo = await import('./follow-ups.ts');
    ({ ensureUser } = await import('./users.ts'));
    await ensureUser(USER, 'zzq-follow-ups@cadence.test');
    await ensureUser(OTHER, 'zzq-follow-ups-other@cadence.test');
  }, 30_000);

  beforeEach(async () => {
    await sql`delete from cadence.follow_ups where user_id in (${USER}, ${OTHER})`;
  });

  afterAll(async () => {
    await sql`delete from cadence.follow_ups where user_id in (${USER}, ${OTHER})`;
    await sql`delete from cadence.users where id in (${USER}, ${OTHER})`;
    await sql.end({ timeout: 5 });
  }, 30_000);

  it('notes, lists newest first, and closes by the shown prefix', async () => {
    const a = await repo.noteFollowUp(USER, { text: 'zzq ask about the race entry', due_on: '2026-11-07' });
    const b = await repo.noteFollowUp(USER, { text: 'zzq see how the knee is' });
    expect(a.due_on).toBe('2026-11-07');
    expect(b.due_on).toBeNull();

    const open = await repo.listOpenFollowUps(USER);
    expect(open.map((f) => f.text)).toEqual(['zzq see how the knee is', 'zzq ask about the race entry']);
    expect(open[0]?.age_days).toBe(0);

    const closed = await repo.closeFollowUp(
      USER,
      a.follow_up_id.slice(0, repo.FOLLOW_UP_ID_PREFIX),
      'coach',
      'entry confirmed',
    );
    expect(closed?.follow_up_id).toBe(a.follow_up_id);
    expect((await repo.listOpenFollowUps(USER)).map((f) => f.follow_up_id)).toEqual([b.follow_up_id]);

    const [row] = await sql<Array<{ closed_by: string; outcome: string }>>`
      select closed_by, outcome from cadence.follow_ups where follow_up_id = ${a.follow_up_id}`;
    expect(row).toEqual({ closed_by: 'coach', outcome: 'entry confirmed' });
  });

  it("another user's id is a no-op, and a too-short prefix never matches", async () => {
    const theirs = await repo.noteFollowUp(OTHER, { text: 'zzq not yours' });
    expect(await repo.closeFollowUp(USER, theirs.follow_up_id, 'coach')).toBeNull();
    expect(await repo.closeFollowUp(OTHER, theirs.follow_up_id.slice(0, 4), 'coach')).toBeNull();
    expect(await repo.listOpenFollowUps(OTHER)).toHaveLength(1);
  });

  it('expiry: an item past the limit leaves the list, and is closed as expired on the next note', async () => {
    const old = await repo.noteFollowUp(USER, { text: 'zzq from long ago' });
    await sql`update cadence.follow_ups
                 set created_at = now() - make_interval(days => ${repo.FOLLOW_UP_EXPIRY_DAYS + 1})
               where follow_up_id = ${old.follow_up_id}`;
    expect(await repo.listOpenFollowUps(USER)).toEqual([]);

    await repo.noteFollowUp(USER, { text: 'zzq new one' });
    const [row] = await sql<Array<{ closed_by: string | null }>>`
      select closed_by from cadence.follow_ups where follow_up_id = ${old.follow_up_id}`;
    expect(row?.closed_by).toBe('expired');
  });

  it('the list is capped', async () => {
    for (let i = 0; i < 10; i++) await repo.noteFollowUp(USER, { text: `zzq item ${i}` });
    expect(await repo.listOpenFollowUps(USER)).toHaveLength(8);
    expect(await repo.listOpenFollowUps(USER, 3)).toHaveLength(3);
  });

  it("the coach's own note reads as 'coach' — on both sides of 0062", async () => {
    const n = await repo.noteFollowUp(USER, { text: 'zzq ask about the knee' });
    expect(n.source).toBe('coach');
    expect((await repo.listOpenFollowUps(USER)).map((f) => f.source)).toEqual(['coach']);
    const closed = await repo.closeFollowUp(USER, n.follow_up_id, 'coach');
    expect(closed?.source).toBe('coach');
  });

  it('a fact-review follow-up keeps its source and evidence (0062)', async () => {
    const fr = await repo.noteFollowUp(USER, {
      text: 'zzq are you back at the gym?',
      source: 'fact-review',
      evidence: 'zzq stale: [e1] vs [c1]',
    });
    expect(fr.source).toBe('fact-review');
    await repo.noteFollowUp(USER, { text: 'zzq ask about the race entry' });
    expect((await repo.listOpenFollowUps(USER)).map((f) => [f.text, f.source])).toEqual([
      ['zzq ask about the race entry', 'coach'],
      ['zzq are you back at the gym?', 'fact-review'],
    ]);
    const [row] = await sql<Array<{ source: string; evidence: string | null }>>`
      select source, evidence from cadence.follow_ups where follow_up_id = ${fr.follow_up_id}`;
    expect(row).toEqual({ source: 'fact-review', evidence: 'zzq stale: [e1] vs [c1]' });
    expect((await repo.closeFollowUp(USER, fr.follow_up_id, 'coach'))?.source).toBe('fact-review');
  });

  it('the column refuses a source outside the two (0062)', async () => {
    await expect(
      sql`insert into cadence.follow_ups (user_id, text, source) values (${USER}, 'zzq bad source', 'zzq-broker')`,
    ).rejects.toThrow(/check constraint/);
  });
});
