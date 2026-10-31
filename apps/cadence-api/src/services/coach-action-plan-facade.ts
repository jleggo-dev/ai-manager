import type { CoachActionTool } from './coach-action-types.ts';
import { EXTEND_HORIZON } from './coach-action-extend-horizon.ts';
import { BUILD_WEEK_AHEAD } from './coach-action-build-week-ahead.ts';
import { PAUSE_WEEK } from './coach-action-pause-week.ts';
import { REVISE_SESSION } from './coach-action-revise-session.ts';
import { START_REPLAN } from './coach-action-start-replan.ts';

/**
 * The plan facades (owner, 2026-09-15: "Build the plan facade so we stop raising the cap").
 *
 * The drawer's label — find_tools' carried description, one hook per tail tool, on every message
 * — hit its budget three times in twelve days, and the `plan` category was where the tools were
 * landing: five actions that each moved one part of the week, each its own entry, each its own
 * decision for her to get right. The nutrition reads had the same shape a month earlier and
 * `get_nutrition` (retrieval/nutrition-facade.ts) is the answer that held: one door, the choice
 * as a PARAMETER where a menu belongs, the originals kept implemented and dispatched to. GitHub's
 * `issue_read` with a `method` enum is the published precedent.
 *
 * Two doors rather than one, because a facade's description still has to teach every parameter
 * with a worked example inside 800 characters (TOOL-HARNESS.md step 3), and five actions' worth
 * of parameters do not fit through one:
 *
 *  - `shape_week` — the week's EDGES: `extend` runs this week longer (extend_horizon),
 *    `build_ahead` writes next week early (build_week_ahead), `pause` clears a stretch
 *    (pause_week). All three take effect at once.
 *  - `rebuild` — from their words: `session` reprograms what is inside one upcoming session
 *    (revise_session, at once), `week` redoes the plan itself in the background and ends in a
 *    card (start_replan). PLAN-CHANGES.md's rungs 1 and 3; rung 2 stays `propose_plan_change`,
 *    always-on.
 *
 * The originals are no longer registered in COACH_ACTION_TOOLS — these are their only door, so
 * `use_tool` cannot reach them by their old names and the eval cases name the facades with an
 * argument check on the choice (the get_nutrition precedent, B2/B3). Their own files, contracts
 * and tests are untouched; a facade only decides which of them runs. `edit_calendar` stays a
 * tool of its own: one dated session is the calendar layer, not the week's shape.
 */

/** A refusal names what did NOT happen and the choices, and stops (the pause_week wording). */
const refusedWeek = (reason: string): string => `Nothing was changed to their week: ${reason}`;

const WEEK_ACTIONS = {
  extend: EXTEND_HORIZON,
  build_ahead: BUILD_WEEK_AHEAD,
  pause: PAUSE_WEEK,
} as const;
type WeekAction = keyof typeof WEEK_ACTIONS;
const isWeekAction = (v: unknown): v is WeekAction => typeof v === 'string' && v in WEEK_ACTIONS;

export const SHAPE_WEEK: CoachActionTool = {
  name: 'shape_week',
  description:
    'Change the shape of their week at its edges — one action per call, all taking effect immediately. "extend" runs the CURRENT week longer: {"action": "extend", "days": 14} makes it two weeks counted from the day it began (28 at most); the check-in moves to the new end. "build_ahead" writes NEXT week now on the same rhythm: {"action": "build_ahead"}; the check-in does not move. "pause" clears every session between two dates and deletes nothing: {"action": "pause", "start": "2026-09-07", "end": "2026-09-13", "reason": "funeral"}; "start" defaults to today. Use it when they ask to plan further ahead, to see next week early, or for a stretch with nothing on it. What is IN the week is propose_plan_change; a finished week rolls forward with build_next_week.',
  parameters: {
    properties: {
      action: {
        type: 'string',
        enum: Object.keys(WEEK_ACTIONS),
        description: '"extend" this week, "build_ahead" for next week early, or "pause" a stretch.',
      },
      days: {
        type: 'number',
        description:
          'Required for "extend": the week\'s total length in days from the day it began — 14 for two weeks, 28 at most. Omit otherwise.',
      },
      start: { type: 'string', description: 'For "pause": first paused day, YYYY-MM-DD. Defaults to today.' },
      end: {
        type: 'string',
        description:
          'Required for "pause": last paused day, YYYY-MM-DD. The plan runs again the day after. Omit otherwise.',
      },
      reason: { type: 'string', description: 'For "pause": why, in their own words. Omit when they did not say.' },
    },
    required: ['action'],
  },
  async run(userId, params) {
    const action = params.action;
    if (!isWeekAction(action)) {
      return refusedWeek(
        `"${String(action ?? '')}" is not one of ${Object.keys(WEEK_ACTIONS).join(', ')}. Their plan is unchanged.`,
      );
    }
    return WEEK_ACTIONS[action].run(userId, params);
  },
};

const REBUILD_SCOPES = {
  session: REVISE_SESSION,
  week: START_REPLAN,
} as const;
type RebuildScope = keyof typeof REBUILD_SCOPES;
const isScope = (v: unknown): v is RebuildScope => typeof v === 'string' && v in REBUILD_SCOPES;

export const REBUILD: CoachActionTool = {
  name: 'rebuild',
  description:
    'Rebuild from their words — one session, or the whole week. {"scope": "session", "session": "Strength", "steer": "add chest and abs", "date": "2026-09-01"} reprograms what is INSIDE one upcoming session and takes effect immediately ("session" as the plan lists it; omit "date" for the soonest one). {"scope": "week", "steer": "more recovery, keep the long run"} redoes the plan itself in the background — minutes, ending in a card they tap; nothing changes until that tap. "steer" is always THEIR words, never your rewrite. Use "session" when they want the work within a session different, "week" only when they ask for the week itself reshaped. Moving, resizing, dropping or adding commitments is propose_plan_change; a first-ever plan is the build card, not this.',
  parameters: {
    properties: {
      scope: {
        type: 'string',
        enum: Object.keys(REBUILD_SCOPES),
        description:
          '"session" for what is inside one upcoming session; "week" for the plan itself, in the background.',
      },
      steer: {
        type: 'string',
        description: 'What should be different, in THEIR words — never your summary of what they asked.',
      },
      session: {
        type: 'string',
        description: 'Required for "session": which one, by the title the plan lists. Omit for "week".',
      },
      date: {
        type: 'string',
        description: 'For "session": the day it is scheduled, YYYY-MM-DD. Omit to take the soonest upcoming one.',
      },
    },
    required: ['scope', 'steer'],
  },
  async run(userId, params) {
    const scope = params.scope;
    if (!isScope(scope)) {
      return `Nothing was rebuilt: "${String(scope ?? '')}" is not one of ${Object.keys(REBUILD_SCOPES).join(', ')}. Their plan is unchanged.`;
    }
    return REBUILD_SCOPES[scope].run(userId, params);
  },
};

/** The originals these two front — kept as modules, no longer registered as tools of their own. */
export const PLAN_FACADE_COVERS = [
  ...Object.values(WEEK_ACTIONS).map((t) => t.name),
  ...Object.values(REBUILD_SCOPES).map((t) => t.name),
] as readonly string[];
