/**
 * The follow-ups repo against the real table (0061): user scoping, the id-prefix close, the
 * ambiguous-prefix refusal, and expiry on the write path. P7b's cases are at the bottom: expiry
 * counted from the due date, the list order, the open count and the ever-had check, and ids that
 * a LIKE read as wildcards. Plus 0062's `source` and `evidence` —
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

  it('notes, lists the dated one first, and closes by the shown prefix', async () => {
    const a = await repo.noteFollowUp(USER, { text: 'zzq ask about the race entry', due_on: '2026-11-07' });
    const b = await repo.noteFollowUp(USER, { text: 'zzq see how the knee is' });
    expect(a.due_on).toBe('2026-11-07');
    expect(b.due_on).toBeNull();

    // Dated before undated, whatever was noted last (P7b; this was newest-first before).
    const open = await repo.listOpenFollowUps(USER);
    expect(open.map((f) => f.text)).toEqual(['zzq ask about the race entry', 'zzq see how the knee is']);
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

  /* ── P7b ─────────────────────────────────────────────────────────────────────────────────── */

  /** Push a row's created_at (and optionally its due date) back in time, in the database's own clock. */
  const backdate = (id: string, createdDaysAgo: number, dueInDays?: number) =>
    dueInDays === undefined
      ? sql`update cadence.follow_ups set created_at = now() - make_interval(days => ${createdDaysAgo})
             where follow_up_id = ${id}`
      : sql`update cadence.follow_ups set created_at = now() - make_interval(days => ${createdDaysAgo}),
                    due_on = (now() + make_interval(days => ${dueInDays}))::date
             where follow_up_id = ${id}`;
  const closedBy = async (id: string) =>
    (
      await sql<Array<{ closed_by: string | null }>>`
      select closed_by from cadence.follow_ups where follow_up_id = ${id}`
    )[0]?.closed_by ?? null;

  it('finding 1: expiry counts from the due date — a dated item not yet due stays, an undated one goes', async () => {
    const undated = await repo.noteFollowUp(USER, { text: 'zzq undated, noted long ago' });
    const dueLater = await repo.noteFollowUp(USER, { text: 'zzq race in the spring' });
    // Both noted past the window; one is due a month from now.
    await backdate(undated.follow_up_id, repo.FOLLOW_UP_EXPIRY_DAYS + 1);
    await backdate(dueLater.follow_up_id, repo.FOLLOW_UP_EXPIRY_DAYS + 1, 30);

    expect((await repo.listOpenFollowUps(USER)).map((f) => f.text)).toEqual(['zzq race in the spring']);
    await repo.noteFollowUp(USER, { text: 'zzq triggers the sweep' });
    expect(await closedBy(undated.follow_up_id)).toBe('expired');
    expect(await closedBy(dueLater.follow_up_id)).toBeNull();
  });

  it.each([
    ['past its due date by more than the window: expires', -(90 + 2), 'expired'],
    ['past its due date, inside the window: stays', -(90 - 2), null],
  ])('finding 1: a dated item %s', async (_label, dueInDays, want) => {
    const f = await repo.noteFollowUp(USER, { text: 'zzq dated, noted long ago' });
    await backdate(f.follow_up_id, 400, dueInDays);
    await repo.noteFollowUp(USER, { text: 'zzq triggers the sweep' });
    expect(await closedBy(f.follow_up_id)).toBe(want);
  });

  it('finding 1: dated ones first, soonest due first, then undated newest first', async () => {
    await repo.noteFollowUp(USER, { text: 'zzq undated older' });
    await repo.noteFollowUp(USER, { text: 'zzq due march', due_on: '2027-03-01' });
    await repo.noteFollowUp(USER, { text: 'zzq due january', due_on: '2027-01-15' });
    await repo.noteFollowUp(USER, { text: 'zzq undated newer' });
    expect((await repo.listOpenFollowUps(USER)).map((f) => f.text)).toEqual([
      'zzq due january',
      'zzq due march',
      'zzq undated newer',
      'zzq undated older',
    ]);
  });

  it('finding 2: the list says how many are open in all, past the cap', async () => {
    for (let i = 0; i < repo.FOLLOW_UPS_SHOWN + 2; i++) await repo.noteFollowUp(USER, { text: `zzq item ${i}` });
    const list = await repo.getFollowUpList(USER);
    expect(list.items).toHaveLength(repo.FOLLOW_UPS_SHOWN);
    expect(list.open).toBe(repo.FOLLOW_UPS_SHOWN + 2);
    expect(list.everHad).toBe(true);
    // The hidden ones are the oldest undated, so the newest is shown first.
    expect(list.items[0]?.text).toBe(`zzq item ${repo.FOLLOW_UPS_SHOWN + 1}`);
  });

  it('finding 3: never had one → nothing; had one and closed it → none open; open → the list', async () => {
    expect(await repo.getFollowUpList(USER)).toEqual({ items: [], open: 0, everHad: false });

    const f = await repo.noteFollowUp(USER, { text: 'zzq see how the knee is' });
    const open = await repo.getFollowUpList(USER);
    expect(open.items.map((i) => i.follow_up_id)).toEqual([f.follow_up_id]);
    expect(open.open).toBe(1);

    await repo.closeFollowUp(USER, f.follow_up_id, 'coach');
    expect(await repo.getFollowUpList(USER)).toEqual({ items: [], open: 0, everHad: true });
    // Another person's rows never count as theirs.
    expect((await repo.getFollowUpList(OTHER)).everHad).toBe(false);
  });

  it.each([
    ['eight underscores', '________'],
    ['eight percent signs', '%%%%%%%%'],
    ['half an id, then wildcards', null],
  ])('finding 5: %s closes nothing — LIKE read them as wildcards', async (_label, given) => {
    const f = await repo.noteFollowUp(USER, { text: 'zzq the only open one' });
    const id = given ?? `${f.follow_up_id.slice(0, 4)}____`;
    expect(await repo.closeFollowUp(USER, id, 'coach')).toBeNull();
    expect(await closedBy(f.follow_up_id)).toBeNull();
  });

  it('finding 5, through the action: a bracketed id closes the row, and an impossible day writes nothing', async () => {
    const { NOTE_FOLLOW_UP, CLOSE_FOLLOW_UP } = await import('../services/coach-action-follow-ups.ts');
    const refused = await NOTE_FOLLOW_UP.run(USER, { text: 'zzq race entry', due_on: '2026-02-30' });
    expect(refused).toMatch(/^nothing changed: .*a real day/);
    expect(await repo.getFollowUpList(USER)).toEqual({ items: [], open: 0, everHad: false });

    const noted = await NOTE_FOLLOW_UP.run(USER, { text: 'zzq race entry', due_on: '2026-11-07' });
    const id = /\[([0-9a-f]{8})\]/.exec(noted)?.[1];
    expect(id).toBeDefined();
    const closed = await CLOSE_FOLLOW_UP.run(USER, { id: `[${id}]`, outcome: 'zzq entry confirmed' });
    expect(closed).toMatch(/^changed: Closed \[/);
    expect((await repo.getFollowUpList(USER)).open).toBe(0);
  });
});
