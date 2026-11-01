import { sql } from '../db/sql.ts';

/**
 * The things the coach said she would come back to (0061). She writes them through
 * note_follow_up and closes them through close_follow_up (services/coach-action-follow-ups.ts);
 * every turn reads the open ones (services/retrieval/follow-ups-function.ts). Nothing here is
 * inferred: a row exists only because she chose to write it.
 */

/**
 * After this many days an open follow-up is closed as `expired` — on the next write, never on read.
 * Counted from the LATER of when it was noted and its due date (P7b): "ask about the race in March",
 * noted in November, is not stale in February — it is not due yet.
 */
export const FOLLOW_UP_EXPIRY_DAYS = 90;
/** The id prefix the coach is shown and may close by. Long enough that two of one person's never collide. */
export const FOLLOW_UP_ID_PREFIX = 8;
/** How many open follow-ups her context shows; the render says how many more there are. */
export const FOLLOW_UPS_SHOWN = 8;

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

/**
 * When an open follow-up expires is counted from: the later of when it was noted and when it is
 * due. `greatest` skips a null, so an undated one counts from when it was noted.
 */
const EXPIRY_FROM = sql`greatest(created_at, due_on::timestamptz)`;
/** Still inside the window — open ones past it are left out even before the sweep closes them. */
const NOT_EXPIRED = sql`${EXPIRY_FROM} > now() - make_interval(days => ${FOLLOW_UP_EXPIRY_DAYS})`;

/**
 * The open ones in list order — dated ones first, soonest due first, then the undated ones newest
 * first — with the total open count on every row (a window count is taken before the limit).
 * Ordering by `created_at` alone put a date due tomorrow below eight newer undated notes, off the list.
 */
async function selectOpen(userId: string, limit: number): Promise<Array<FollowUp & { open_total: number }>> {
  return sql<Array<FollowUp & { open_total: number }>>`
    select follow_up_id, text, to_char(due_on, 'YYYY-MM-DD') as due_on, created_at::text as created_at,
           floor(extract(epoch from (now() - created_at)) / 86400)::int as age_days, ${SOURCE_COL},
           count(*) over ()::int as open_total
      from cadence.follow_ups f
     where user_id = ${userId} and closed_at is null and ${NOT_EXPIRED}
     order by due_on asc nulls last, created_at desc
     limit ${limit}`;
}

const withoutTotal = ({ open_total: _total, ...f }: FollowUp & { open_total: number }): FollowUp => f;

/** Open follow-ups in list order (see selectOpen), capped. */
export async function listOpenFollowUps(userId: string, limit = FOLLOW_UPS_SHOWN): Promise<FollowUp[]> {
  return (await selectOpen(userId, limit)).map(withoutTotal);
}

/** What her context shows: the open ones up to the cap, how many are open in all, and whether any ever existed. */
export interface FollowUpList {
  /** The open ones shown, in list order. */
  items: FollowUp[];
  /** How many are open in all — more than `items.length` when the cap hid some. */
  open: number;
  /**
   * Whether this person has any follow-up at all, open or closed. A list she saw on an earlier turn
   * is still in the conversation, so once there has ever been one, "none open" has to be said out
   * loud or that old list reads as current. Someone who never had one has no old list to correct.
   */
  everHad: boolean;
}

export async function getFollowUpList(userId: string, limit = FOLLOW_UPS_SHOWN): Promise<FollowUpList> {
  const rows = await selectOpen(userId, limit);
  const open = rows[0]?.open_total ?? 0;
  if (open > 0) return { items: rows.map(withoutTotal), open, everHad: true };
  // Asked only when nothing is open: one existence check over their rows.
  const [row] = await sql<Array<{ ever: boolean }>>`
    select exists(select 1 from cadence.follow_ups where user_id = ${userId}) as ever`;
  return { items: [], open: 0, everHad: Boolean(row?.ever) };
}

const UUID_CHARS = /^[0-9a-f-]+$/;

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
  // Only what a uuid is made of. `starts_with` matches characters literally — the LIKE it replaces
  // read `_` and `%` as wildcards, so "________" (eight underscores) closed whichever item was open.
  if (prefix.length < FOLLOW_UP_ID_PREFIX || !UUID_CHARS.test(prefix)) return null;
  const rows = await sql<FollowUp[]>`
    update cadence.follow_ups as f
       set closed_at = now(), closed_by = ${closedBy}, outcome = ${outcome ?? null}
     where user_id = ${userId} and closed_at is null
       and starts_with(follow_up_id::text, ${prefix})
       and (select count(*) from cadence.follow_ups f2
             where f2.user_id = ${userId} and f2.closed_at is null and starts_with(f2.follow_up_id::text, ${prefix})) = 1
    returning follow_up_id, text, to_char(due_on, 'YYYY-MM-DD') as due_on, created_at::text as created_at,
              floor(extract(epoch from (now() - created_at)) / 86400)::int as age_days, ${SOURCE_COL}`;
  return rows[0] ?? null;
}

/** Close everything of theirs past the window (counted from EXPIRY_FROM) as `expired`. Returns how many. */
export async function expireFollowUps(userId: string): Promise<number> {
  const rows = await sql<Array<{ follow_up_id: string }>>`
    update cadence.follow_ups
       set closed_at = now(), closed_by = 'expired'
     where user_id = ${userId} and closed_at is null and not (${NOT_EXPIRED})
    returning follow_up_id`;
  return rows.length;
}
