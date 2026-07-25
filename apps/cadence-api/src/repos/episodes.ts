import { sql, json } from '../db/sql.ts';
import type { DisruptedEpisode, EpisodeOverride } from '@cadence/shared';
import type { Activity, Equipment } from '@cadence/shared';

/** DB row shape (start_date/end_date columns; protect_momentum after migration 0006). */
interface EpisodeRow {
  episode_id: string;
  type: DisruptedEpisode['type'];
  start_date: string;
  end_date: string;
  available_equipment: Partial<Equipment>[];
  constraints: Record<string, unknown>;
  temp_activities: Partial<Activity>[];
  overrides: EpisodeOverride[];
  protect_momentum: boolean;
  tone: DisruptedEpisode['tone'] | null;
  status: DisruptedEpisode['status'];
}

function toEpisode(r: EpisodeRow): DisruptedEpisode {
  return {
    episode_id: r.episode_id,
    type: r.type,
    start: r.start_date,
    end: r.end_date,
    available_equipment: r.available_equipment,
    constraints: r.constraints,
    temp_activities: r.temp_activities,
    overrides: r.overrides,
    protect_momentum: r.protect_momentum,
    tone: r.tone ?? undefined,
    status: r.status,
  };
}

/** The user's currently-active episode, if any. At most one is active at a time (enter guards). */
export async function getActiveEpisode(userId: string): Promise<DisruptedEpisode | null> {
  const [row] = await sql<EpisodeRow[]>`
    select episode_id, type, to_char(start_date, 'YYYY-MM-DD') as start_date,
           to_char(end_date, 'YYYY-MM-DD') as end_date, available_equipment, constraints,
           temp_activities, overrides, protect_momentum, tone, status
    from cadence.episodes
    where user_id = ${userId} and status = 'active'
    order by created_at desc limit 1`;
  return row ? toEpisode(row) : null;
}

export interface NewEpisode {
  type: DisruptedEpisode['type'];
  start: string;
  end: string;
  available_equipment?: Partial<Equipment>[];
  constraints?: Record<string, unknown>;
  temp_activities?: Partial<Activity>[];
  overrides?: EpisodeOverride[];
  tone?: DisruptedEpisode['tone'];
}

export async function insertEpisode(userId: string, ep: NewEpisode): Promise<DisruptedEpisode> {
  const [row] = await sql<EpisodeRow[]>`
    insert into cadence.episodes
      (user_id, type, start_date, end_date, available_equipment, constraints, temp_activities, overrides, protect_momentum, tone, status)
    values (
      ${userId}, ${ep.type}, ${ep.start}, ${ep.end},
      ${json(ep.available_equipment ?? [])}, ${json(ep.constraints ?? {})},
      ${json(ep.temp_activities ?? [])}, ${json(ep.overrides ?? [])},
      true, ${ep.tone ?? null}, 'active'
    )
    returning episode_id, type, to_char(start_date, 'YYYY-MM-DD') as start_date,
              to_char(end_date, 'YYYY-MM-DD') as end_date, available_equipment, constraints,
              temp_activities, overrides, protect_momentum, tone, status`;
  if (!row) throw new Error('insertEpisode: no row returned');
  return toEpisode(row);
}

/** Mark the active episode ended (idempotent — a no-op if it isn't this user's active episode). */
export async function endActiveEpisode(userId: string, episodeId: string): Promise<void> {
  await sql`
    update cadence.episodes set status = 'ended'
    where user_id = ${userId} and episode_id = ${episodeId} and status = 'active'`;
}

/** Episode date-ranges (active OR ended) overlapping [from, to] — feeds the streak's `inEpisode`
 *  shield, so a no-show inside a past disrupted stretch never counts as a slip. */
export async function listEpisodeRanges(
  userId: string,
  from: string,
  to: string,
): Promise<Array<{ start: string; end: string }>> {
  return sql<Array<{ start: string; end: string }>>`
    select to_char(start_date, 'YYYY-MM-DD') as start, to_char(end_date, 'YYYY-MM-DD') as end
    from cadence.episodes
    where user_id = ${userId} and start_date <= ${to} and end_date >= ${from}`;
}
