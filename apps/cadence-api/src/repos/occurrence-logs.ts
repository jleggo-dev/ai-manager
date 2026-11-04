import { sql } from '../db/sql.ts';
import type { OccurrenceLog } from '@cadence/shared';

/**
 * The person's logged sessions, newest first, as the exercise-history read walks them
 * (services/exercise-history.ts). Its own file: repos/occurrences.ts is at the size gate.
 * `title` narrows to one activity (case-insensitive, like listRecentLogsByTitle); without it every
 * logged session is in play. Bounded so a long-lived account never asks for an unbounded scan.
 */
export async function listLoggedOccurrences(
  userId: string,
  opts: { title?: string; limit?: number } = {},
): Promise<Array<{ date: string; title: string; log: OccurrenceLog }>> {
  const limit = Math.min(400, Math.max(1, opts.limit ?? 200));
  const title = opts.title?.trim().toLowerCase();
  return sql<Array<{ date: string; title: string; log: OccurrenceLog }>>`
    select to_char(o.date, 'YYYY-MM-DD') as date, a.title, o.log
    from cadence.occurrences o
    join cadence.activities a on a.activity_id = o.activity_id
    where o.user_id = ${userId} and o.log is not null
      ${title ? sql`and lower(a.title) = ${title}` : sql``}
    order by o.date desc
    limit ${limit}`;
}
