import { sql } from '../db/sql.ts';
import type { StreakState } from '@cadence/shared';

/**
 * "Who is due right now?" — one scoped query per push producer.
 *
 * These are the only reads the scheduler tick performs, and their shape is the difference between
 * a tick that costs nothing and a tick that gets more expensive every time someone signs up. The
 * rule they all follow: **start from `notification_prefs` and join outward.**
 *
 * Starting there is not a micro-optimisation. `notification_prefs` only has a row for someone who
 * has been through the Settings screen, and `enabled` is false until they opt in — so the join
 * bounds every query to people who have actually asked to hear from Cadence, before any
 * per-user work happens. The alternative shape (walk `users`, ask a question about each) is a
 * full-table scan dressed as a loop, and it looks fine right up until it doesn't.
 *
 * Each query is also bounded in TIME (a date window) and returns only the columns the producer
 * needs to decide. None of them writes anything: a producer proposing a candidate is not the same
 * as sending one, and dedupe/quiet-hours/cap all live downstream in dispatch.
 */

export interface FreezeSaveCandidate {
  user_id: string;
  timezone: string | null;
  streak_state: StreakState | null;
}

/**
 * Users whose streak was rescued by a freeze in the last few days.
 *
 * The window is three days rather than "yesterday" because the producer, not the database, owns
 * the definition of yesterday: that is a question about the USER's timezone, and a `current_date`
 * comparison here would answer it in the server's. Three days is enough slack for every zone plus
 * a tick that ran late, and the producer then filters exactly.
 */
export async function listFreezeSaveCandidates(): Promise<FreezeSaveCandidate[]> {
  return sql<FreezeSaveCandidate[]>`
    select u.id as user_id, u.timezone, u.streak_state
    from cadence.notification_prefs p
    join cadence.users u on u.id = p.user_id
    where p.enabled
      and u.streak_state->>'last_saved_by_freeze' is not null
      and (u.streak_state->>'last_saved_by_freeze')::date >= current_date - 3`;
}

export interface DetourEndingCandidate {
  user_id: string;
  timezone: string | null;
  episode_id: string;
  end_date: string;
}

/** Active episodes ending within the next couple of days — same timezone-slack reasoning. */
export async function listDetourEndingCandidates(): Promise<DetourEndingCandidate[]> {
  return sql<DetourEndingCandidate[]>`
    select u.id as user_id, u.timezone, e.episode_id, to_char(e.end_date, 'YYYY-MM-DD') as end_date
    from cadence.notification_prefs p
    join cadence.users u on u.id = p.user_id
    join cadence.episodes e on e.user_id = u.id and e.status = 'active'
    where p.enabled
      and e.end_date between current_date and current_date + 2`;
}

export interface ReEntryCandidate {
  user_id: string;
  timezone: string | null;
  last_done: string;
}

/**
 * Users whose most recent completed day is 3-9 days ago.
 *
 * The window is closed at BOTH ends, and the upper bound is the decay ladder made structural: past
 * day nine nobody is a candidate, so there is no code path on which a third nudge can be produced,
 * however the tick is scheduled or replayed. Escalation cannot be reintroduced by accident.
 *
 * An active detour excludes the user entirely. They have already told us why they are away, and
 * asking again is the one thing this nudge exists not to do.
 */
export async function listReEntryCandidates(): Promise<ReEntryCandidate[]> {
  return sql<ReEntryCandidate[]>`
    select u.id as user_id, u.timezone, to_char(max(o.date), 'YYYY-MM-DD') as last_done
    from cadence.notification_prefs p
    join cadence.users u on u.id = p.user_id
    join cadence.occurrences o on o.user_id = u.id and o.status = 'done'
    where p.enabled
      and not exists (
        select 1 from cadence.episodes e
         where e.user_id = u.id and e.status = 'active'
      )
    group by u.id, u.timezone
    having max(o.date) between current_date - 9 and current_date - 3`;
}

export interface CheckinDueCandidate {
  user_id: string;
  timezone: string | null;
  generated_at: string;
}

/**
 * Users whose ACTIVE plan's week has already run out.
 *
 * The bound is the SAME fact `computeWeekState` (plan-view.ts) reports to the app as
 * `checkin_due` — `generated_at + DEFAULT_HORIZON_DAYS <= now()` — read the same way, so the push
 * and the in-app affordance can never disagree about which day it started being true. Hardcoded
 * as 7 days rather than the constant because a query can't share a TS import; if
 * `DEFAULT_HORIZON_DAYS` ever moves, this bound has to move with it by hand.
 *
 * No upper bound, unlike `listReEntryCandidates`'s day-9 ceiling — there is nothing here to decay
 * away from. An ignored check-in never supersedes the active plan, so `generated_at` (and the
 * `target` the producer derives from it) never changes; the SAME row keeps coming back on every
 * tick until the user actually commits a next week, which is exactly what makes the producer's
 * one-shot-per-week guarantee hold (see checkin-due.ts).
 */
export async function listCheckinDueCandidates(): Promise<CheckinDueCandidate[]> {
  return sql<CheckinDueCandidate[]>`
    select u.id as user_id, u.timezone, to_char(pl.generated_at, 'YYYY-MM-DD') as generated_at
    from cadence.notification_prefs p
    join cadence.users u on u.id = p.user_id
    join cadence.plans pl on pl.user_id = u.id and pl.status = 'active'
    where p.enabled
      and pl.generated_at <= now() - interval '7 days'`;
}

export interface WeatherMoveCandidate {
  user_id: string;
  timezone: string | null;
  home_location: { lat: number; lon: number } | null;
  occurrence_id: string;
  date: string;
  title: string;
  category: string | null;
  time_of_day: string | null;
}

/**
 * Still-pending, still-timed sessions in the next two calendar days, for users with a home
 * location (no location, no forecast, no nudge).
 *
 * Outdoor-ness is decided in the producer via `isOutdoorActivity`, not in SQL: that predicate is
 * shared with the session/weather paths, and a second copy of it as a regex here would drift the
 * first time someone adds "paddle" to one and not the other.
 */
export async function listWeatherMoveCandidates(): Promise<WeatherMoveCandidate[]> {
  return sql<WeatherMoveCandidate[]>`
    select u.id as user_id, u.timezone, u.home_location,
           o.occurrence_id, to_char(o.date, 'YYYY-MM-DD') as date,
           a.title, a.category, a.schedule->>'time_of_day' as time_of_day
    from cadence.notification_prefs p
    join cadence.users u on u.id = p.user_id
    join cadence.occurrences o on o.user_id = u.id and o.status = 'pending'
    join cadence.activities a on a.activity_id = o.activity_id and a.kind = 'user'
    where p.enabled
      and u.home_location is not null
      and o.date between current_date and current_date + 1
      and coalesce(a.schedule->>'time_of_day', '') <> ''`;
}
