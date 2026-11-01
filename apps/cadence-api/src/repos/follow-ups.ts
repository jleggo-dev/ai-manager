import { sql } from '../db/sql.ts';

/**
 * The things the coach said she would come back to (0061). She writes them through
 * note_follow_up and closes them through close_follow_up (services/coach-action-follow-ups.ts);
 * every turn reads the open ones (services/retrieval/follow-ups-function.ts). Nothing here is
 * inferred: a row exists only because she chose to write it.
 */

/** After this many days an open follow-up is closed as `expired` — on the next write, never on read. */
export const FOLLOW_UP_EXPIRY_DAYS = 90;
/** The id prefix the coach is shown and may close by. Long enough that two of one person's never collide. */
export const FOLLOW_UP_ID_PREFIX = 8;

/**
 * Who put a follow-up there (0062): the coach through note_follow_up, or the weekly fact review
 * (services/fact-review.ts), which turns a disagreement between two facts into a question for her
 * to raise. The union is derived from the array so a reader checking a value never drifts from it.
 */
export const FOLLOW_UP_SOURCES = ['coach', 'fact-review'] as const;
export type FollowUpSource = (typeof FOLLOW_UP_SOURCES)[number];

/**
 * `source` read so it works on both sides of 0062: before the column exists the row has no such
 * key and every row is the coach's. The coach's turn reads this list every message, so a deploy
 * that lands before the migration must not break it.
 */
const SOURCE_COL = sql`coalesce(to_jsonb(f) ->> 'source', 'coach') as source`;

export interface FollowUp {
  follow_up_id: string;
  text: string;
  /** YYYY-MM-DD, or null when she gave no date. */
  due_on: string | null;
  /** ISO timestamp. */
  created_at: string;
  /** Whole days since it was noted, at read time. */
  age_days: number;
  /** Who noted it. Every row the repo returns carries it; absent reads as 'coach'. */
  source?: FollowUpSource;
}

export interface NoteFollowUpInput {
  text: string;
  due_on?: string | null;
  /** Absent = the coach's own note. */
  source?: FollowUpSource;
  /** Why it was asked — the fact review's reason, quoting the facts. */
  evidence?: string | null;
}

export async function noteFollowUp(userId: string, input: NoteFollowUpInput): Promise<FollowUp> {
  // Expiry rides the write path so the read stays a read: by the time she notes something new,
  // anything of hers past the limit is closed as expired and off the list.
  await expireFollowUps(userId);
  // The coach's own note leaves the 0062 columns to their defaults, so note_follow_up keeps
  // working on a database the migration has not reached yet.
  const rows = input.source
    ? await sql<FollowUp[]>`
        insert into cadence.follow_ups as f (user_id, text, due_on, source, evidence)
        values (${userId}, ${input.text}, ${input.due_on ?? null}::date, ${input.source}, ${input.evidence ?? null})
        returning follow_up_id, text, to_char(due_on, 'YYYY-MM-DD') as due_on, created_at::text as created_at,
                  0 as age_days, ${SOURCE_COL}`
    : await sql<FollowUp[]>`
        insert into cadence.follow_ups as f (user_id, text, due_on)
        values (${userId}, ${input.text}, ${input.due_on ?? null}::date)
        returning follow_up_id, text, to_char(due_on, 'YYYY-MM-DD') as due_on, created_at::text as created_at,
                  0 as age_days, ${SOURCE_COL}`;
  const row = rows[0];
  if (!row) throw new Error('follow-up insert returned no row');
  return row;
}

/** Open follow-ups, newest first, capped. Those past expiry are left out even before the sweep closes them. */
export async function listOpenFollowUps(userId: string, limit = 8): Promise<FollowUp[]> {
  return sql<FollowUp[]>`
    select follow_up_id, text, to_char(due_on, 'YYYY-MM-DD') as due_on, created_at::text as created_at,
           floor(extract(epoch from (now() - created_at)) / 86400)::int as age_days, ${SOURCE_COL}
      from cadence.follow_ups f
     where user_id = ${userId} and closed_at is null
       and created_at > now() - make_interval(days => ${FOLLOW_UP_EXPIRY_DAYS})
     order by created_at desc
     limit ${limit}`;
}

/**
 * Close one by id or id prefix (the render shows the first FOLLOW_UP_ID_PREFIX characters). Scoped
 * to the user, so another person's id is a no-op. Returns the closed row, or null when nothing
 * open matched — one match only: a prefix that fits two rows closes neither.
 */
export async function closeFollowUp(
  userId: string,
  idOrPrefix: string,
  closedBy: 'coach' | 'user',
  outcome?: string | null,
): Promise<FollowUp | null> {
  const prefix = idOrPrefix.trim().toLowerCase();
  if (prefix.length < FOLLOW_UP_ID_PREFIX) return null;
  const rows = await sql<FollowUp[]>`
    update cadence.follow_ups as f
       set closed_at = now(), closed_by = ${closedBy}, outcome = ${outcome ?? null}
     where user_id = ${userId} and closed_at is null
       and follow_up_id::text like ${prefix + '%'}
       and (select count(*) from cadence.follow_ups f2
             where f2.user_id = ${userId} and f2.closed_at is null and f2.follow_up_id::text like ${prefix + '%'}) = 1
    returning follow_up_id, text, to_char(due_on, 'YYYY-MM-DD') as due_on, created_at::text as created_at,
              floor(extract(epoch from (now() - created_at)) / 86400)::int as age_days, ${SOURCE_COL}`;
  return rows[0] ?? null;
}

/** Close everything of theirs older than the limit as `expired`. Returns how many. */
export async function expireFollowUps(userId: string): Promise<number> {
  const rows = await sql<Array<{ follow_up_id: string }>>`
    update cadence.follow_ups
       set closed_at = now(), closed_by = 'expired'
     where user_id = ${userId} and closed_at is null
       and created_at <= now() - make_interval(days => ${FOLLOW_UP_EXPIRY_DAYS})
    returning follow_up_id`;
  return rows.length;
}
