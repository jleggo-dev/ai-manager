import { getActiveEpisode } from '../repos/episodes.ts';
import { getActivePlan } from '../repos/plans.ts';
import { enterEpisode } from './episode.ts';
import type { CoachActionTool } from './coach-action-types.ts';

/**
 * `pause_week` — clear a stretch of the plan instead of refusing to.
 *
 * The gap this closes was a refusal with nowhere to go. Asked for a week with nothing on it — a
 * bereavement, a deliberate week off, a stretch too full to train — the only thing the coach could
 * reach was `propose_plan_change` with removals, and that tool's own guard rejects an edit slate
 * that empties the plan ("An empty week is not a rhythm"). So the honest answer to a plain request
 * was "no", and the person's choices were to ignore their plan for a week or delete it.
 *
 * The product already had the right concept and never exposed it: an episode pauses the base plan
 * across a stretch of days and overlays temporary activities, and the base plan resumes untouched.
 * A pause is that same episode with NO temporary activities — `skipTempActivities` on
 * `enterEpisode`, because drafting lighter options would hand back the thing they asked not to
 * have. Nothing is deleted; every paused session is still on file and comes back on its own.
 *
 * Tail tier with a `DRAWER_HOOKS` line (owner ruling 2026-08-30: new tools default to the drawer).
 */

/** Eight weeks, inclusive of both ends. Past this it is a detour with its own shape, not a pause. */
const MAX_PAUSE_DAYS = 56;

const DAY = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The same UTC calendar day `episode.ts` works in, so the two never disagree by a day. */
function todayIso(): string {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())).toISOString().slice(0, 10);
}

function addDaysIso(iso: string, days: number): string {
  return new Date(new Date(`${iso}T00:00:00Z`).getTime() + days * DAY).toISOString().slice(0, 10);
}

/** Days from `a` to `b` counting both ends — one day pauses to "1 day", not 0. */
function daysInclusive(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY) + 1;
}

/**
 * Why a rejection reads the way it does: it names what did NOT happen, states the reason as a
 * fact, and stops. It never tells her what to say to the person or what to offer instead — that is
 * hers (owner red line, "facts, not picks").
 */
function refused(reason: string): string {
  return `Nothing was paused: ${reason} Their plan is unchanged.`;
}

/** What is already running, in the words that distinguish the two things it can be. */
function openStretch(episode: { type: string; start: string; end: string; constraints: unknown }): string {
  const paused = (episode.constraints as { paused?: unknown } | null)?.paused === true;
  return paused ? 'a pause' : `a detour (${episode.type})`;
}

export const PAUSE_WEEK: CoachActionTool = {
  name: 'pause_week',
  description:
    'Pause every scheduled session between two dates. Takes effect immediately: nothing is deleted, the plan itself is not edited, and the sessions come back on their own the day after the last paused day. Use it when they want a stretch with nothing on their plate — a death in the family, a deliberate stretch off, days too full to train — instead of dropping commitments with propose_plan_change, which refuses an edit that would leave the plan with nothing on it. Pass {"start": "2026-09-07", "end": "2026-09-13", "reason": "funeral, travelling all week"}. "start" defaults to today, "end" is the last paused day, "reason" is their own words and may be omitted. It refuses a stretch over eight weeks, and refuses while a pause or detour is already running.',
  parameters: {
    properties: {
      end: {
        type: 'string',
        description: 'The last paused day, as YYYY-MM-DD. The plan runs again the day after it.',
      },
      start: {
        type: 'string',
        description: 'First paused day, as YYYY-MM-DD. Defaults to today; a past date is read as today.',
      },
      reason: {
        type: 'string',
        description: 'Why, in their own words, stored with the pause. Omit it when they did not say.',
      },
    },
    required: ['end'],
  },
  async run(userId, params) {
    const today = todayIso();
    const rawStart = String(params.start ?? '').trim();
    const rawEnd = String(params.end ?? '').trim();

    if (rawStart && !ISO_DATE.test(rawStart)) {
      return refused(`"${rawStart}" is not a start date in YYYY-MM-DD form.`);
    }
    if (!rawEnd) return refused('no last paused day was given.');
    if (!ISO_DATE.test(rawEnd)) return refused(`"${rawEnd}" is not a last paused day in YYYY-MM-DD form.`);

    const start = rawStart && rawStart > today ? rawStart : today;
    if (rawEnd < start) {
      return refused(
        rawEnd < today
          ? `${rawEnd} has already passed, so there is nothing ahead of it to pause.`
          : `the last paused day ${rawEnd} is before the first paused day ${start}.`,
      );
    }
    const span = daysInclusive(start, rawEnd);
    if (span > MAX_PAUSE_DAYS) {
      return refused(
        `${start} to ${rawEnd} is ${span} days, and this pauses at most ${MAX_PAUSE_DAYS} days (eight weeks).`,
      );
    }

    // Both checks run here rather than being read off enterEpisode's return, which reports the two
    // cases identically enough that she would be told the wrong one.
    const open = await getActiveEpisode(userId);
    if (open) {
      return refused(`${openStretch(open)} is already running from ${open.start} to ${open.end}.`);
    }
    if (!(await getActivePlan(userId))) {
      return refused('they have no committed plan, so there are no scheduled sessions to pause.');
    }

    const reason = String(params.reason ?? '')
      .trim()
      .slice(0, 200);
    const entered = await enterEpisode(userId, {
      type: 'custom',
      start,
      end: rawEnd,
      skipTempActivities: true,
      constraints: { paused: true, ...(reason ? { reason } : {}) },
    });
    if (!entered) {
      return refused('the pause did not save. Do not tell them it is done.');
    }

    // The dates come off the STORED episode, not off the arguments: enterEpisode reads a past
    // start as today, and she should describe the stretch that exists.
    const { start: from, end: to } = entered.episode;
    return `Paused from ${from} to ${to}: their scheduled sessions in that window are paused, nothing is deleted, and the rhythm resumes on ${addDaysIso(to, 1)}. Their plan is otherwise unchanged.`;
  },
};
