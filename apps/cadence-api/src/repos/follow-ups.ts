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

export interface FollowUp {
  follow_up_id: string;
  text: string;
  /** YYYY-MM-DD, or null when she gave no date. */
  due_on: string | null;
  /** ISO timestamp. */
  created_at: string;
  /** Whole days since it was noted, at read time. */
  age_days: number;
}

export async function noteFollowUp(userId: string, input: { text: string; due_on?: string | null }): Promise<FollowUp> {
  // Expiry rides the write path so the read stays a read: by the time she notes something new,
  // anything of hers past the limit is closed as expired and off the list.
  await expireFollowUps(userId);
  const rows = await sql<FollowUp[]>`
    insert into cadence.follow_ups (user_id, text, due_on)
    values (${userId}, ${input.text}, ${input.due_on ?? null}::date)
    returning follow_up_id, text, to_char(due_on, 'YYYY-MM-DD') as due_on, created_at::text as created_at,
              0 as age_days`;
  const row = rows[0];
  if (!row) throw new Error('follow-up insert returned no row');
  return row;
}

/** Open follow-ups, newest first, capped. Those past expiry are left out even before the sweep closes them. */
export async function listOpenFollowUps(userId: string, limit = 8): Promise<FollowUp[]> {
  return sql<FollowUp[]>`
    select follow_up_id, text, to_char(due_on, 'YYYY-MM-DD') as due_on, created_at::text as created_at,
           floor(extract(epoch from (now() - created_at)) / 86400)::int as age_days
      from cadence.follow_ups
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
    update cadence.follow_ups
       set closed_at = now(), closed_by = ${closedBy}, outcome = ${outcome ?? null}
     where user_id = ${userId} and closed_at is null
       and follow_up_id::text like ${prefix + '%'}
       and (select count(*) from cadence.follow_ups f2
             where f2.user_id = ${userId} and f2.closed_at is null and f2.follow_up_id::text like ${prefix + '%'}) = 1
    returning follow_up_id, text, to_char(due_on, 'YYYY-MM-DD') as due_on, created_at::text as created_at,
              floor(extract(epoch from (now() - created_at)) / 86400)::int as age_days`;
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
