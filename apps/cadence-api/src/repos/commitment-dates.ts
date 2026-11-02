import { sql } from '../db/sql.ts';

/**
 * Commitment-lineage reads over occurrences — the join that makes "my Sunday ruck" one thing
 * across plan versions (see `Activity.commitment_id`). Its own file because occurrences.ts sits
 * at the 500-line gate; a new read on a different axis is a new file, not an allowlist entry.
 */

/**
 * The (commitment, date) pairs already SETTLED — done, skipped, anything but pending — in a
 * window, across every plan version. The horizon fill reads this so a commitment completed
 * today is not re-issued when a later commit gives its activity a new row (see `ensureHorizon` in services/plan-horizon.ts).
 * Activities with no commitment lineage cannot be matched to anything and are left out.
 *
 * `date` comes back as TEXT, never the column itself: postgres.js turns a `date` into a JS Date,
 * and the caller keys a Set on `${commitment_id}|${date}` — a Date stringifies to "Sun Nov 01
 * 2026 …", so the key never matched and every settled commitment was re-issued after a commit
 * (the owner's breakfast and piano, done in the morning, came back pending beside the done ones
 * on 2026-11-01). The unit test mocked strings, so it could not see it; the DB test can.
 */
export async function listSettledCommitmentDates(
  userId: string,
  fromDate: string,
  toDate: string,
): Promise<Array<{ commitment_id: string; date: string }>> {
  return sql<Array<{ commitment_id: string; date: string }>>`
    select distinct a.commitment_id, to_char(o.date, 'YYYY-MM-DD') as date
    from cadence.occurrences o
    join cadence.activities a on a.activity_id = o.activity_id
    where o.user_id = ${userId}
      and o.date >= ${fromDate} and o.date <= ${toDate}
      and o.status <> 'pending'
      and a.commitment_id is not null`;
}
