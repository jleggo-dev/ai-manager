import { getActivePlan } from '../repos/plans.ts';
import { listActivities } from '../repos/activities.ts';
import { listGoals, listGoalsByStatus, updateGoal, setGoalStatus } from '../repos/goals.ts';
import { insertGoalEvent } from '../repos/goal-events.ts';
import {
  correctOccurrenceLog,
  deleteOccurrence,
  listLoggedForCorrection,
  listRecentForLogging,
} from '../repos/occurrences.ts';
import { logOccurrence } from './session-log.ts';
import { getUser, setMacroTargets, setPendingPlan } from '../repos/users.ts';
import { sanitizeTargets } from './nutrition-day.ts';
import type { CoachActionTool } from './coach-action-types.ts';
import { UPDATE_CONSTRAINT } from './coach-action-constraint.ts';

/** Today, YYYY-MM-DD — stamped on a target change so the weekly review throttle can see it. */
const today = (): string => new Date().toISOString().slice(0, 10);
import { expandRecurrence } from './scheduling.ts';
import { applyPlanEdits, matchActivity, type PlanEdit } from './plan-edit.ts';

/**
 * The coach's ACTION tools — the half of the harness that changes something.
 *
 * Two shapes, and which one a tool takes is decided by whether a person can CHECK the change in a
 * sentence.
 *
 * **The plan is proposed, never applied.** `propose_plan_change` writes to `pending_plan` — by
 * definition uncommitted — and the week moves only when the user taps Apply, which runs the same
 * `POST /plan/lock` path a first build runs. Suggest-never-auto-apply is structural here rather
 * than a rule the model is asked to remember: there is no code path from that tool call to a
 * committed plan. Two properties fall out of it and are worth keeping:
 * - The card renders what the TOOL computed, not what the coach said it computed. The diff is
 *   read back from the stored proposal, so a turn that describes the change wrongly still shows
 *   the person the truth before they agree to it.
 * - The edits are applied in code (plan-edit.ts), so the change that lands is exactly the change
 *   that was asked for — no re-synthesis quietly rewriting the rest of the week.
 *
 * **A goal or a mis-logged session is applied on the spot.** These write immediately, and the
 * gate is in the instruction rather than in a tap: act only on what the user has plainly decided.
 *
 * **Why the plan gets a card and a goal does not.** A plan change is many rows and materializes a
 * week of occurrences — you cannot check it in a sentence, so it gets rendered and tapped. A goal
 * target, a deadline, or a mis-logged distance is ONE legible fact the coach says out loud
 * ("100 books down to 50 — done"), and the persona already settles this shape for detours:
 * "their plain yes is enough… never ask them to confirm again elsewhere." Making someone tap a
 * card to re-confirm the sentence they just said is friction pretending to be safety. What holds
 * instead is the gate in each description — apply only what the user has plainly decided, never
 * your own read — plus an event on the goal's own history, so every change is visible and
 * attributable after the fact.
 */

export type { CoachActionTool } from './coach-action-types.ts';

/** The actions the engine can carry out. One list, shared with the schema so they cannot drift. */
export const PLAN_EDIT_ACTIONS = ['move', 'retime', 'resize', 'remove', 'add', 'rework'] as const;

const EDIT_SCHEMA = {
  type: 'array',
  description: 'The changes to make, applied in order.',
  items: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: [...PLAN_EDIT_ACTIONS],
        description:
          'move = which days it happens on; retime = what time of day; resize = how many minutes; remove = drop it; add = a new commitment; rework = change what the session CONTAINS, keeping its slot (swap an exercise, change the focus).',
      },
      activities: {
        type: 'array',
        items: { type: 'string' },
        description:
          'WHICH commitments, by the handles get_active_plan prints (e.g. ["a3f19c2b","5d01f807"]). Several in one edit is how you change every run at once. Not used for add.',
      },
      activity: {
        type: 'string',
        description:
          'Fallback when you have no handle: the title, exactly as the plan lists it. Refused if two share it — use activities instead. Not used for add.',
      },
      on_days: {
        type: 'array',
        items: { type: 'string' },
        description:
          'ONLY for narrowing the `activity` title fallback when two share a name — the days it happens on NOW. Meaningless beside `activities` handles, and it is NOT where you say the new days: that is `days`. Omit whenever you passed a handle.',
      },
      days: {
        type: 'array',
        items: { type: 'string' },
        description:
          'For move and add: ALL the days it should happen on afterwards — this replaces its whole weekly pattern, so a twice-a-week session keeps both days only if you name both, e.g. ["tuesday","friday"].',
      },
      time_of_day: {
        type: 'string',
        description:
          'REQUIRED on add, and for retime. A clock time ("07:00") or a part of day ("morning"). If it genuinely has no fixed slot, pass "anytime" — but that is a DECISION to make with them, not a field to leave out: an add without this is refused. When they have not said, use the time their other sessions of that kind run at, or ask.',
      },
      duration_min: {
        type: 'integer',
        description:
          'For resize, add and rework: minutes of the ACTIVITY ITSELF — exactly the number they said. "A 40 minute run" is 40; "a 20 minute meditation" is 20. Do NOT pad it for warm-up, cool-down or getting there: the app adds that around the effort and shows them the total to set aside. Never quietly shrink it either — 20 minutes of meditation means 20 minutes meditating.',
      },
      title: {
        type: 'string',
        description:
          'For add: what the new commitment is called. For rework: a new name, only if the change earns one.',
      },
      how_to: {
        type: 'string',
        description:
          'For rework AND add: what this session should CONTAIN from now on, in plain words — "dead hangs instead of farmers carries", "conversational pace, ~5km". Its character and any distance go here; how many minutes the effort runs for is duration_min, not this. Applies to every future session of it.',
      },
      goal_title: { type: 'string', description: 'For add: which goal it serves, by title.' },
      why: { type: 'string', description: 'For add: one sentence on why it is worth doing.' },
    },
    required: ['action'],
  },
};

/**
 * Words the model reaches for that mean an action by another name.
 *
 * `rename` is the obvious verb for what `rework` does with a title, and on 2026-08-17 she used it
 * twice in one call. Both were dropped on the floor by the filter below and nothing said so. An
 * alias is kinder than a rejection here because the intent is unambiguous — she named a title and
 * a commitment, which is exactly a rework.
 */
const ACTION_ALIASES: Record<string, PlanEdit['action']> = { rename: 'rework', retitle: 'rework', reschedule: 'move' };

function asEdits(raw: unknown): { edits: PlanEdit[]; unknown: string[] } {
  if (!Array.isArray(raw)) return { edits: [], unknown: [] };
  const unknown: string[] = [];
  const edits = raw
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
    .map((e) => ({
      action: (ACTION_ALIASES[String(e.action ?? '').toLowerCase()] ??
        String(e.action ?? '').toLowerCase()) as PlanEdit['action'],
      ...(typeof e.activity === 'string' ? { activity: e.activity } : {}),
      ...(Array.isArray(e.activities) ? { activities: e.activities.map(String) } : {}),
      ...(Array.isArray(e.on_days) ? { on_days: e.on_days.map(String) } : {}),
      ...(Array.isArray(e.days) ? { days: e.days.map(String) } : {}),
      ...(typeof e.time_of_day === 'string' ? { time_of_day: e.time_of_day } : {}),
      ...(e.duration_min != null ? { duration_min: Number(e.duration_min) } : {}),
      ...(typeof e.title === 'string' ? { title: e.title } : {}),
      ...(typeof e.how_to === 'string' ? { how_to: e.how_to } : {}),
      ...(typeof e.goal_title === 'string' ? { goal_title: e.goal_title } : {}),
      ...(typeof e.why === 'string' ? { why: e.why } : {}),
    }))
    /**
     * An action this engine cannot perform is REPORTED, never quietly removed.
     *
     * The old line filtered silently, so `rename` — a word the schema does not list and the model
     * naturally reaches for — vanished twice in one call while the coach told the user she was
     * renaming two commitments. Nothing anywhere recorded that two thirds of the call did nothing.
     */
    .filter((e) => {
      if ((PLAN_EDIT_ACTIONS as readonly string[]).includes(e.action)) return true;
      unknown.push(String(e.action || '(none)'));
      return false;
    });
  return { edits, unknown };
}

export const COACH_ACTION_TOOLS: Record<string, CoachActionTool> = {
  propose_plan_change: {
    name: 'propose_plan_change',
    description:
      'Propose a change to the plan they already have — move a session to other days, retime, resize, drop, add one, or rework what one CONTAINS. This does NOT change anything: it works out the resulting week and shows a card with an Apply button, so the plan moves only when they tap. Use it the moment they name a change, in the same reply; never claim it is done before the tap. Read get_active_plan first — it prints a handle beside every commitment, and edits address them BY handle. One edit can carry several, so "make all my runs 45 minutes" is ONE edit. Pass {"plan_version": 7, "edits": [{"action": "resize", "activities": ["a3f19c2b", "5d01f807"], "duration_min": 45}]}. A whole rebuild is the build card instead.',
    parameters: {
      properties: {
        edits: EDIT_SCHEMA,
        plan_version: {
          type: 'integer',
          description:
            'The version get_active_plan reported. Handles keep working across versions; this only stops a TITLE-addressed edit landing on a plan that moved. Omit if you did not read it.',
        },
      },
      required: ['edits'],
    },
    async run(userId, params) {
      const { edits, unknown } = asEdits(params.edits);
      const unknownNote = unknown.length
        ? `\nNOT DONE — this build has no "${unknown.join('", "')}" action. The actions are: ${PLAN_EDIT_ACTIONS.join(', ')}. To rename a commitment use rework with a title. Do NOT tell them those parts happened.`
        : '';
      if (!edits.length) {
        return `No usable changes were given, so nothing was proposed. Ask what they want changed.${unknownNote}`;
      }

      const plan = await getActivePlan(userId);
      if (!plan) {
        return 'They have no active plan yet, so there is nothing to change — offer to build one (the build card) instead.';
      }
      /**
       * The plan moved after she read it.
       *
       * Since 0036 a handle names a COMMITMENT, not a row, so it survives an Apply — a handle that
       * resolves is proof she is editing the thing she meant, whatever version it is on now, and
       * the card recomputes the before→after from current state either way. What does NOT survive
       * is the title fallback: it would happily match against the new plan and carry out intent
       * formed against the old one. So the version gate now guards exactly that path.
       */
      const declared = Number(params.plan_version);
      const moved = Number.isFinite(declared) && declared !== plan.version;
      if (moved && edits.some((e) => !e.activities?.length)) {
        return `Their plan is v${plan.version} now, not v${declared}, and at least one of those edits names a commitment by title rather than by handle — against a plan that has moved, that could change the wrong thing. NOTHING was changed. Call get_active_plan again and re-propose using the handles it prints.`;
      }
      const [activities, goals, me] = await Promise.all([
        listActivities(plan.plan_id),
        listGoalsByStatus(userId, ['committed', 'confirmed']),
        getUser(userId),
      ]);
      const goalTitleById: Record<string, string> = {};
      for (const g of goals) goalTitleById[g.goal_id] = g.title;

      /**
       * Build on the card already on screen, rather than replacing it.
       *
       * `setPendingPlan` stores ONE proposal, and every call used to recompute from the committed
       * plan — so a second call wiped the first without a word. On 2026-08-17 the coach proposed
       * moving Box breathing to Sunday, then a minute later proposed two resizes, and the owner got
       * a card with only the runs on it and reported that she had promised the move and not made
       * it. She had. The next call deleted it.
       *
       * Accumulating is what she plainly meant: two things she said she would change, both on one
       * card. A proposal only disappears when the user applies it or taps Not now, both of which
       * clear `pending_plan` — so there is no stale-proposal case to age out here.
       */
      const pending = me?.pending_plan;
      const carried = pending?.activities?.length ? pending.activities : undefined;
      const priorChanges = carried ? (pending?.rationale ?? '').split('\n').filter(Boolean) : [];

      const {
        activities: next,
        changes: fresh,
        rejected,
        noops,
        ignored,
      } = applyPlanEdits(activities, edits, goalTitleById, carried);
      const changes = [...priorChanges, ...fresh];
      /**
       * A field its action never reads is SAID, never swallowed — and never blocking: the valid
       * rest of the edit still proposes and the card still goes up. She is just told which words
       * did nothing and where they would have worked, so the next call says it right instead of
       * retrying the same drop five times (2026-08-17, "the Wednesday one" pushed through `why`).
       */
      const ignoredLines = ignored.length
        ? ['Parts of those edits were not used:', ...ignored.map((i) => `- ${i}`)]
        : [];
      /**
       * No changes means NO CARD — including when every edit asked for the state the plan is
       * already in. On 2026-08-17 a resize to the value already stored produced "Easy run: 40 min
       * → 40 min" twice, wrote a pending plan, and put up an Apply button; the owner tapped it and
       * committed a version byte-identical to its predecessor, regenerating ten prescribed sessions
       * to change nothing. A card must mean something is different, or it is a lie with a button.
       */
      /**
       * `fresh`, not `changes` — the gate asks whether THIS call did anything. Keying it off the
       * accumulated list would let a call that achieved nothing re-announce the card already on
       * screen as though it were new work.
       */
      if (!fresh.length) {
        const standing = priorChanges.length
          ? [`The card already up is unchanged and still shows: ${priorChanges.join('; ')}.`]
          : [];
        if (noops.length && !rejected.length) {
          return [
            'Nothing was proposed, because the plan already says all of this:',
            ...noops.map((n) => `- ${n}`),
            ...standing,
            ...ignoredLines,
            'Tell them plainly it is already set that way. Do NOT put up a card and do NOT claim you changed anything.',
            unknownNote,
          ]
            .filter(Boolean)
            .join('\n');
        }
        return [
          'Nothing could be changed:',
          ...rejected.map((r) => `- ${r}`),
          ...noops.map((n) => `- ${n}`),
          ...standing,
          ...ignoredLines,
          'Tell the user plainly what you could not find, and ask them which commitment they meant.',
          unknownNote,
        ]
          .filter(Boolean)
          .join('\n');
      }
      if (!next.length) {
        return 'That would empty their plan entirely, so it was not proposed. An empty week is not a rhythm — suggest keeping at least one thing.';
      }

      await setPendingPlan(userId, {
        activities: next,
        note: changes.join('; '),
        rationale: changes.join('\n'),
        goal_ids: [...new Set(next.map((a) => a.goal_id).filter((id): id is string => !!id))],
        created_at: new Date().toISOString(),
      });

      return [
        priorChanges.length
          ? 'Added to the card already up — it now shows ALL of this, with one Apply button:'
          : 'Proposed — the user now has a card showing exactly this, with an Apply button:',
        ...changes.map((c) => `- ${c}`),
        // Say it moved, so she describes the week that exists rather than the one she read.
        ...(moved
          ? [`Note: their plan is v${plan.version} now, not v${declared} — this was applied to the current one.`]
          : []),
        ...(rejected.length ? ['Could not do:', ...rejected.map((r) => `- ${r}`)] : []),
        // Partly-already-true edits: on the card they would read as changes, so they are told to
        // her here instead and left off it.
        ...(noops.length ? ['Already the case, so not on the card:', ...noops.map((n) => `- ${n}`)] : []),
        ...ignoredLines,
        'Say in one line what you have put up and that it is theirs to apply. Do NOT claim it is done or scheduled — it is not, until they tap it.',
        unknownNote,
      ]
        .filter(Boolean)
        .join('\n');
    },
  },

  update_goal: {
    name: 'update_goal',
    description:
      'Change one of the user\'s goals: lower or raise the number they are aiming at, move the date, mark it finished, or stop working on it. Use when they have plainly decided one of those in words — never on your own read that a goal looks too hard, and never to tidy up. This DOES take effect immediately: a goal is one fact you can say out loud, so your sentence confirming it is the confirmation, and every change is written to the goal\'s own history. Read get_objectives first and name the goal exactly as listed. Pass {"goal": "Read 100 books", "action": "retarget", "target": 50, "unit": "books"}, or {"goal": "Run a 10k", "action": "redate", "date": "2026-11-01"}.',
    parameters: {
      properties: {
        goal: { type: 'string', description: 'Which goal, by its title exactly as get_objectives lists it.' },
        action: {
          type: 'string',
          enum: ['retarget', 'redate', 'complete', 'stop'],
          description:
            'retarget = change the number they are aiming at; redate = change the date they are aiming for; complete = they finished it; stop = they are no longer working on it.',
        },
        target: { type: 'number', description: 'The new number. Required for retarget.' },
        unit: {
          type: 'string',
          description: 'The unit (books, km, kg). Optional for retarget; omit to keep the current one.',
        },
        date: { type: 'string', description: 'The new date to aim for, as YYYY-MM-DD. Required for redate.' },
      },
      required: ['goal', 'action'],
    },
    async run(userId, params) {
      const query = String(params.goal ?? '').trim();
      const action = String(params.action ?? '');
      if (!query) return 'No goal was named, so nothing changed. Ask which goal they mean.';

      const goals = await listGoals(userId);
      const live = goals.filter((g) => !['completed', 'abandoned'].includes(g.status));
      const goal = matchActivity(live, query);
      if (!goal) {
        const names = live.map((g) => g.title).join(', ') || 'none';
        return `Nothing clearly matches "${query}", so nothing changed. Their goals are: ${names}. Ask which one they mean.`;
      }

      if (action === 'complete' || action === 'stop') {
        const status = action === 'complete' ? 'completed' : 'abandoned';
        await setGoalStatus(userId, goal.goal_id, status);
        await insertGoalEvent(userId, {
          goal_id: goal.goal_id,
          kind: action === 'complete' ? 'completion' : 'note',
          label: action === 'complete' ? `Finished: ${goal.title}` : `Stopped working on: ${goal.title}`,
        }).catch(() => null);
        return action === 'complete'
          ? `Marked "${goal.title}" finished. Say so warmly — this is a thing they did, and it is worth a sentence, not a checkbox.`
          : `Stopped "${goal.title}". Say it plainly and without any suggestion they failed; the sessions that served it stay in their plan until the plan is rebuilt, so offer that if it now looks empty.`;
      }

      if (action === 'retarget') {
        const target = Number(params.target);
        if (!Number.isFinite(target))
          return 'No new target number was given, so nothing changed. Ask what it should be.';
        const unit = typeof params.unit === 'string' && params.unit.trim() ? params.unit.trim() : goal.measure?.unit;
        const was = goal.measure?.target;
        await updateGoal(userId, goal.goal_id, {
          measure: { ...goal.measure, target, ...(unit ? { unit } : {}) },
        });
        await insertGoalEvent(userId, {
          goal_id: goal.goal_id,
          kind: 'note',
          label: `Target changed: ${String(was ?? '?')} → ${target}${unit ? ` ${unit}` : ''}`,
        }).catch(() => null);
        return `"${goal.title}" now aims at ${target}${unit ? ` ${unit}` : ''} (was ${String(was ?? 'unset')}). Say what changed in one line. Their plan still holds the old sessions — if the new target needs a different week, offer to rebuild.`;
      }

      const date = String(params.date ?? '').trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return 'No usable date was given, so nothing changed. Ask what date they are aiming for.';
      }
      const wasDate = goal.timeframe?.end;
      await updateGoal(userId, goal.goal_id, { timeframe: { ...goal.timeframe, end: date } });
      await insertGoalEvent(userId, {
        goal_id: goal.goal_id,
        kind: 'note',
        label: `Date moved: ${wasDate ?? 'unset'} → ${date}`,
      }).catch(() => null);
      return `"${goal.title}" now aims at ${date} (was ${wasDate ?? 'no date'}). Say what changed. A later date usually means the week can ease off, and an earlier one usually cannot be met by wishing — if the pace no longer fits, say so and offer to rebuild.`;
    },
  },

  correct_log: {
    name: 'correct_log',
    description:
      'Fix a session that was recorded wrong — the distance or duration was off, or it never happened. Use when the user corrects something already on file; to record something new they just did, let them log it normally instead. Takes effect immediately, because it is their own correction of their own record and asking twice is absurd. Read get_recent_logs or get_workout_history first so you name the right session. Pass {"activity": "Easy run", "date": "2026-08-12", "metrics": {"distance_km": 5}}, or add {"not_done": true} when it did not happen.',
    parameters: {
      properties: {
        activity: { type: 'string', description: 'Which session, by the title the plan lists.' },
        date: {
          type: 'string',
          description: 'The day it was recorded, as YYYY-MM-DD. Omit to take the most recent one.',
        },
        metrics: {
          type: 'object',
          description:
            'The corrected numbers, e.g. {"distance_km": 5} — name only the fields that were wrong; the rest keep their stored values. Required unless not_done is true.',
        },
        not_done: {
          type: 'boolean',
          description: 'True when the session did not actually happen. Omit to correct the numbers instead.',
        },
      },
      required: ['activity'],
    },
    async run(userId, params) {
      const query = String(params.activity ?? '').trim();
      if (!query) return 'No session was named, so nothing changed. Ask which one they mean.';
      const date = String(params.date ?? '').trim();

      const rows = await listLoggedForCorrection(userId);
      const scoped = date ? rows.filter((r) => r.date === date) : rows;
      const found = matchActivity(scoped, query);
      if (!found) {
        const recent = rows
          .slice(0, 5)
          .map((r) => `${r.date} ${r.title}`)
          .join('; ');
        return `No recorded session clearly matches "${query}"${date ? ` on ${date}` : ''}, so nothing changed. Recent ones: ${recent || 'none'}. Ask which they mean.`;
      }

      if (params.not_done === true) {
        // Was this day ever actually asked of them? A scheduled slot stays and becomes not-done;
        // an occurrence that only exists because something logged it is erased. Marking the
        // latter 'skipped' would invent a missed session on a day nothing was scheduled, and then
        // count it against their consistency — punishing them for correcting our mistake.
        const wasScheduled =
          !!found.recurrence && expandRecurrence(found.recurrence, found.date, found.date).length > 0;
        if (wasScheduled) {
          await correctOccurrenceLog(userId, found.occurrence_id, { status: 'skipped' });
          return `Corrected: ${found.title} on ${found.date} is no longer counted as done — it was on the plan that day, so it now reads as not done. Say so plainly; a session that did not happen is information, never a failure, and it needs no commiseration.`;
        }
        await deleteOccurrence(userId, found.occurrence_id);
        return `Removed: ${found.title} on ${found.date} is gone entirely — nothing was scheduled that day, so that entry only existed because it was logged. Confirm it in one line without apologising at length.`;
      }

      const raw = (params.metrics ?? {}) as Record<string, unknown>;
      const named: Record<string, number> = {};
      for (const [k, v] of Object.entries(raw)) {
        const n = Number(v);
        if (Number.isFinite(n) && Object.keys(named).length < 12) named[k.slice(0, 40)] = n;
      }
      if (!Object.keys(named).length) {
        return 'No corrected numbers were given and it was not marked as missed, so nothing changed. Ask what the right numbers were.';
      }
      /**
       * A correction NAMES fields, and the fields it does not name survive — constraint-merge
       * rule 1: nothing is dropped by silence. This used to hand `named` straight down, and
       * `correctOccurrenceLog` sets the whole value column, so correcting a run's distance to
       * 8 km erased its duration (the eval catch, correct-logged-distance — the same shape as
       * the capture merge that once ate a whole equipment list). Merge here, corrections winning
       * field by field, and rebuild the summary from the MERGED record, so both the stored
       * summary and the reply below say what the row now says — all of it.
       */
      const value = { ...(found.value ?? {}), ...named };
      const summary = Object.entries(value)
        .map(([k, v]) => `${v} ${k.replace(/_/g, ' ')}`)
        .join(', ');
      await correctOccurrenceLog(userId, found.occurrence_id, {
        value,
        ...(found.log ? { log: { ...found.log, summary } } : {}),
      });
      return `Corrected: ${found.title} on ${found.date} now reads ${summary}. Confirm it back in one short line.`;
    },
  },

  update_constraint: UPDATE_CONSTRAINT,

  log_session: {
    name: 'log_session',
    description:
      'Write down how a session went, in their own words, and mark it done. Takes effect immediately. Use when they tell you about one — "that run was good but my HR was all over the place" — because that IS how a session gets logged: they finish it, they come to talk, and talking about it is the record. Use it again to REVISE something already logged when they add or correct it later. Their report is parsed and kept on that session, so it outlives the conversation and the weekly check-in can read it back. Read get_active_plan or get_recent_logs to name the session as the plan lists it. Pass {"session": "Long run", "report": "77 minutes, felt strong for the first hour, HR high on the hills", "date": "2026-08-15"}.',
    parameters: {
      properties: {
        session: { type: 'string', description: 'Which session, by the title the plan lists.' },
        report: {
          type: 'string',
          description:
            'What they said about it, in THEIR words — numbers, how it felt, what went wrong. Never your summary of it.',
        },
        date: { type: 'string', description: 'The day it happened, YYYY-MM-DD. Omit for the most recent one.' },
      },
      required: ['session', 'report'],
    },
    async run(userId, params) {
      const query = String(params.session ?? '').trim();
      const report = String(params.report ?? '').trim();
      if (!query) return 'No session was named, so nothing was written down. Ask which one they mean.';
      if (!report) return 'There was nothing to write down. Ask how it actually went, then log that.';
      const date = String(params.date ?? '').trim();

      const rows = await listRecentForLogging(userId);
      const scoped = date ? rows.filter((r) => r.date === date) : rows;
      const found = matchActivity(scoped, query);
      if (!found) {
        const recent = rows
          .slice(0, 5)
          .map((r) => `${r.date} ${r.title}`)
          .join('; ');
        return `No session clearly matches "${query}"${date ? ` on ${date}` : ''}, so nothing was written down. Recent ones: ${recent || 'none'}. Ask which they mean.`;
      }

      const logged = await logOccurrence(userId, found.occurrence_id, report);
      if (!logged) return 'That could not be written down just now — tell them plainly and offer to try again.';
      return [
        `Logged against ${found.title} (${found.date})${found.logged ? ', replacing what was there' : ' and marked done'}: ${logged.summary}`,
        'Say it back in one short line so they know it is on their file, then carry on with the conversation — do not turn it into a report.',
      ].join('\n');
    },
  },

  set_macro_targets: {
    name: 'set_macro_targets',
    description:
      'Set or adjust the daily calorie and macro targets their eating is coached against. Takes effect immediately. Use to establish targets once you have worked them out together, and — the part that matters most — to ADJUST them when the evidence says they are not doing their job: get_macro_targets reports the actual weekly weight change against a safe rate, and if they are following the numbers and not moving, or moving too fast to be healthy, changing the numbers is the coaching. Say what you changed and why. Never set a calorie target you would not defend out loud; the safety bounds you plan by apply here too. Pass {"kcal": 2100, "protein_g": 150, "carbs_g": 220, "fat_g": 70, "why": "losing 1.1kg/wk is faster than is safe for you — adding 200 back"}.',
    parameters: {
      properties: {
        kcal: { type: 'integer', description: 'Daily calories. Required — the others hang off it.' },
        protein_g: { type: 'integer', description: 'Daily protein in grams. Omit to leave unchanged.' },
        carbs_g: { type: 'integer', description: 'Daily carbohydrate in grams. Omit to leave unchanged.' },
        fat_g: { type: 'integer', description: 'Daily fat in grams. Omit to leave unchanged.' },
        why: {
          type: 'string',
          description:
            'One line on why these numbers, in their terms. Required — a target with no reason cannot be revisited.',
        },
      },
      required: ['kcal', 'why'],
    },
    async run(userId, params) {
      const why = String(params.why ?? '').trim();
      if (!why)
        return 'No reason was given. A target nobody can explain later is a number they will not keep — say why, then set it.';

      const user = await getUser(userId);
      const current = user?.macro_targets ?? {};
      // Through the SAME sanitizer the proposal path uses: range-checked field by field, and an
      // absurd number is dropped rather than clamped into looking deliberate.
      const clean = sanitizeTargets({
        kcal: params.kcal,
        protein_g: params.protein_g ?? current.protein_g,
        carbs_g: params.carbs_g ?? current.carbs_g,
        fat_g: params.fat_g ?? current.fat_g,
      });
      if (!clean?.kcal) {
        return 'Those numbers did not survive the safety check (calories must be a realistic daily figure). Nothing changed — work out something you would defend, then set it.';
      }

      const wasKcal = current.kcal;
      await setMacroTargets(userId, { ...current, ...clean, last_reviewed: today() });
      await insertGoalEvent(userId, {
        kind: 'note',
        label: `Targets ${wasKcal ? `${String(wasKcal)} → ` : 'set to '}${clean.kcal} kcal: ${why}`.slice(0, 200),
      }).catch(() => null);

      const said = ['kcal', 'protein_g', 'carbs_g', 'fat_g']
        .filter((k) => typeof (clean as Record<string, unknown>)[k] === 'number')
        .map((k) => `${k.replace('_g', '')} ${String((clean as Record<string, unknown>)[k])}`)
        .join(', ');
      return [
        `Targets are now ${said}${wasKcal ? ` (was ${String(wasKcal)} kcal)` : ''}, and today's numbers already count against them.`,
        'Tell them what changed and why in one line — this is the adjustment they are paying you for, so it should sound like a decision you made, not a setting that moved.',
      ].join('\n');
    },
  },
};

export const coachActionNames = (): Set<string> => new Set(Object.keys(COACH_ACTION_TOOLS));

export function coachActionDefinitions(): Array<{
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}> {
  return Object.values(COACH_ACTION_TOOLS).map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      description: t.description,
      parameters: {
        type: 'object',
        properties: t.parameters.properties,
        ...(t.parameters.required ? { required: t.parameters.required } : {}),
      },
    },
  }));
}
