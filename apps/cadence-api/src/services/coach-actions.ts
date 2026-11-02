import { getActivePlan } from '../repos/plans.ts';
import { listActivities } from '../repos/activities.ts';
import { listGoalsByStatus } from '../repos/goals.ts';
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
import { defineAction, type CoachActionTool } from './coach-action-types.ts';
import { toolActionFaultText, toolChangeText, toolNothingChangedText } from './tool-response.ts';
import { UPDATE_GOAL } from './coach-action-goal.ts';
import { UPDATE_CONSTRAINT } from './coach-action-constraint.ts';
import { UPDATE_EQUIPMENT } from './coach-action-equipment.ts';
import { OPEN_WEEK_REVIEW } from './coach-action-week-review.ts';
import { BUILD_NEXT_WEEK } from './coach-action-build-week.ts';
import { REBUILD, SHAPE_WEEK } from './coach-action-plan-facade.ts';
import { EDIT_CALENDAR } from './coach-action-edit-calendar.ts';
import { LOG_MEAL } from './coach-action-log-meal.ts';
import { SET_MICRO_TARGET } from './coach-action-micro-target.ts';
import { PROPOSE_PROGRESS_LAYOUT } from './coach-action-progress-layout.ts';
import { UPDATE_REPERTOIRE } from './coach-action-repertoire.ts';
import { OFFER_REPERTOIRE_REVIEW } from './coach-action-offer-repertoire.ts';
import { SEND_QUESTIONNAIRE } from './coach-action-questionnaire.ts';
import { SET_HOME_LOCATION } from './coach-action-home-location.ts';
import { NOTE_FOLLOW_UP, CLOSE_FOLLOW_UP } from './coach-action-follow-ups.ts';

/** Today, YYYY-MM-DD — stamped on a target change so the weekly review throttle can see it. */
const today = (): string => new Date().toISOString().slice(0, 10);
import { expandRecurrence } from './scheduling.ts';
import { applyPlanEdits, matchActivity, type PlanEdit } from './plan-edit.ts';
import { planEditEvidence } from './plan-edit-evidence.ts';
import { PLAN_EDIT_ACTIONS, EDIT_SCHEMA } from './plan-edit-schema.ts';

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

/** Re-exported for callers that used to import it from here (nothing does today, but the schema's
 *  own home is now plan-edit-schema.ts — see that file for `EDIT_SCHEMA` and its field prose). */
export { PLAN_EDIT_ACTIONS } from './plan-edit-schema.ts';

/**
 * Words the model reaches for that mean an action by another name.
 *
 * `rename` is the obvious verb for what `rework` does with a title, and on 2026-08-17 she used it
 * twice in one call. Both were dropped on the floor by the filter below and nothing said so. An
 * alias is kinder than a rejection here because the intent is unambiguous — she named a title and
 * a commitment, which is exactly a rework.
 */
const ACTION_ALIASES: Record<string, PlanEdit['action']> = { rename: 'rework', retitle: 'rework', reschedule: 'move' };

/**
 * Said back whenever a rework goes on the card. On 2026-11-01 the owner asked to swap the bike
 * warm-up in TODAY's session; she put up a rework — which rewrites every future session of that
 * commitment — and told the owner it "changes only today's session". The result now states the reach.
 */
function reworkReach(edits: PlanEdit[]): string[] {
  return edits.some((e) => e.action === 'rework')
    ? [
        'A rework changes what EVERY future session of that commitment contains, from Apply on — not one day. If they meant only one day\'s session, that is rebuild with scope "session"; take this card down with start_over.',
      ]
    : [];
}

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
      ...(typeof e.reason === 'string' ? { reason: e.reason } : {}),
      ...(typeof e.optional === 'boolean' ? { optional: e.optional } : {}),
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
  propose_plan_change: defineAction({
    name: 'propose_plan_change',
    mutates: 'proposes',
    description:
      'Propose a plan change — move, retime, resize, drop, add, or rework what one CONTAINS. {gate} — the card needs a tap; never say it is done before that. Use it for any change they name; read get_active_plan first — edits name commitments BY its handles. A whole week is reshaped by SEVERAL edits in one call: settle the shape with them, then ONE call carrying the full slate; the return reports the proposed week\'s shape and clashes to check before saying it is up. Pass {"plan_version": 7, "edits": [{"action": "resize", "activities": ["a3f19c2b"], "duration_min": 45, "reason": "..."}]}. Calling again ADDS to the card; on a mistake never add a fix beside it — redo with "start_over": true, ONLY the corrected edits. A full rebuild from their words is rebuild with scope "week".',
    parameters: {
      properties: {
        edits: EDIT_SCHEMA,
        plan_version: {
          type: 'integer',
          description:
            'The version get_active_plan reported. Handles keep working across versions; this only stops a TITLE-addressed edit landing on a plan that moved. Omit if you did not read it.',
        },
        start_over: {
          type: 'boolean',
          description:
            'True = the standing card is wrong: discard it first, then build a fresh card from the committed plan out of ONLY this call\'s edits. With an empty "edits" it just clears the card and proposes nothing. Omit or pass false to keep adding to the card already up.',
        },
      },
      required: ['edits'],
    },
    async run(userId, params) {
      const startOver = params.start_over === true;
      const { edits, unknown } = asEdits(params.edits);
      const unknownNote = unknown.length
        ? `NOT DONE — this build has no "${unknown.join('", "')}" action. The actions are: ${PLAN_EDIT_ACTIONS.join(', ')}. To rename a commitment use rework with a title. Do NOT tell them those parts happened.`
        : '';
      if (!edits.length) {
        /**
         * start_over with nothing else IS a complete request: scrap the card. The same clear the
         * user's own "Not now" tap runs (routes/plan.ts pending-change/dismiss) — the plan itself
         * is never touched by it.
         */
        if (startOver) {
          const hadCard = !!(await getUser(userId))?.pending_plan;
          await setPendingPlan(userId, null);
          return hadCard
            ? toolChangeText({
                changed: ['Cleared — the proposal card is gone and no card is up now.'],
                unchanged: ['their plan itself is untouched.'],
                next: [
                  'Tell them it is scrapped, and propose the corrected change whenever they name it.',
                  unknownNote,
                ],
              })
            : toolNothingChangedText(
                'there was no proposal card up, so there was nothing to clear. Their plan is untouched.',
                [unknownNote],
              );
        }
        return toolNothingChangedText('no usable changes were given, so nothing was proposed.', [
          'Ask what they want changed.',
          unknownNote,
        ]);
      }

      const plan = await getActivePlan(userId);
      if (!plan) {
        return toolNothingChangedText('they have no active plan yet, so there is nothing to change.', [
          'Offer to build one (the build card) instead.',
        ]);
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
        return toolNothingChangedText(
          `their plan is v${plan.version} now, not v${declared}, and at least one of those edits names a commitment by title rather than by handle — against a plan that has moved, that could change the wrong thing.`,
          ['Call get_active_plan again and re-propose using the handles it prints.'],
        );
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
       *
       * …unless the card itself is the mistake. Accumulate-only created the inverse trap (live,
       * 2026-08-18): asked for Wednesday-only stretching she added "Stretching — Mon, Wed, Fri",
       * noticed, said "let me redo it properly" — and the redo ADDED beside the wrong add, so the
       * card ended holding both. `start_over` is the third door: drop the standing card BEFORE
       * applying, so this call's edits are computed against the committed plan alone. Dropped
       * even if every corrected edit then fails — the user asked for the wrong card to go, and a
       * failed redo must not quietly resurrect it.
       */
      const hadCard = !!me?.pending_plan;
      if (startOver && hadCard) await setPendingPlan(userId, null);
      const pending = startOver ? undefined : me?.pending_plan;
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
        const allNoops = noops.length > 0 && !rejected.length;
        const facts = allNoops
          ? ['the plan already says all of this, so nothing was proposed:', ...noops.map((n) => `- ${n}`)]
          : ['none of those edits could be made:', ...rejected.map((r) => `- ${r}`), ...noops.map((n) => `- ${n}`)];
        const rest = [
          ...standing,
          ...ignoredLines,
          allNoops
            ? 'Tell them plainly it is already set that way. Do NOT put up a card and do NOT claim you changed anything.'
            : 'Tell the user plainly what you could not find, and ask them which commitment they meant.',
          unknownNote,
        ];
        // start_over already dropped the old card: that IS a change, even though nothing new went up.
        if (startOver && hadCard) {
          return toolChangeText({
            changed: [
              'The old card WAS cleared (start_over), so no card is up at all now — say so, and re-propose once you have the right change.',
            ],
            next: [...facts, ...rest],
          });
        }
        return toolNothingChangedText(facts[0]!, [...facts.slice(1), ...rest]);
      }
      if (!next.length) {
        /**
         * A refusal that names the tool that CAN do it (finding TR-5, 2026-09-03).
         *
         * The old line told her an empty week is not a rhythm and to suggest keeping one thing —
         * advice, and a dead end. Someone asking for a clear week ("nothing on my plate this
         * week") has a real request the product already serves: `pause_week` shelves the stretch
         * without deleting anything, and the plan resumes on its own. Keep these words exact (since
         * HARNESS-V3 P5 they sit behind the `nothing changed:` line, unchanged).
         */
        return toolNothingChangedText(
          'that edit would leave the plan with no commitments, so no change was proposed and their plan is unchanged.',
          ['shape_week with action "pause" clears a stretch of the week without deleting anything.'],
        );
      }

      await setPendingPlan(userId, {
        activities: next,
        note: changes.join('; '),
        rationale: changes.join('\n'),
        goal_ids: [...new Set(next.map((a) => a.goal_id).filter((id): id is string => !!id))],
        created_at: new Date().toISOString(),
      });

      const headline = priorChanges.length
        ? 'Added to the card already up — it now shows ALL of this, with one Apply button:'
        : startOver && hadCard
          ? 'Redone — the old card is gone; the user now has a card showing ONLY this, with an Apply button:'
          : 'Proposed — the user now has a card showing exactly this, with an Apply button:';
      const lines = [
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
        /**
         * The week those edits ADD UP TO — evidence, never a veto (owner 2026-08-31: the coach is
         * the planner; guards report, she adjudicates). Before this, the return was diff lines
         * only, and on 2026-08-31 a proposed Wednesday quietly held hill intervals + an early run
         * + mobility against that day's own one-workout constraint — no tool ever noticed,
         * because nothing showed her the week her edits added up to.
         */
        ...planEditEvidence(next, me?.baseline?.constraints),
        ...reworkReach(edits),
        'What you have put up is theirs to apply. Do NOT claim it is done or scheduled — it is not, until they tap it.',
        unknownNote,
      ];
      return toolChangeText({ changed: [headline], next: lines });
    },
  }),

  update_goal: UPDATE_GOAL,

  correct_log: defineAction({
    name: 'correct_log',
    mutates: 'immediate',
    description:
      'Fix a session that was recorded wrong — the distance or duration was off, or it never happened. Use when the user corrects something already on file; to record something new they just did, let them log it normally instead. {gate}, because it is their own correction of their own record and asking twice is absurd. Read get_recent_logs or get_workout_history first so you name the right session. Pass {"activity": "Easy run", "date": "2026-08-12", "metrics": {"distance_km": 5}}, or add {"not_done": true} when it did not happen.',
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
      if (!query) return toolNothingChangedText('no session was named.', ['Ask which one they mean.']);
      const date = String(params.date ?? '').trim();

      const rows = await listLoggedForCorrection(userId);
      const scoped = date ? rows.filter((r) => r.date === date) : rows;
      const found = matchActivity(scoped, query);
      if (!found) {
        const recent = rows
          .slice(0, 5)
          .map((r) => `${r.date} ${r.title}`)
          .join('; ');
        return toolNothingChangedText(
          `no recorded session clearly matches "${query}"${date ? ` on ${date}` : ''}. Recent ones: ${recent || 'none'}.`,
          ['Ask which they mean.'],
        );
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
          return toolChangeText({
            changed: [
              `Corrected: ${found.title} on ${found.date} is no longer counted as done — it was on the plan that day, so it now reads as not done.`,
            ],
          });
        }
        await deleteOccurrence(userId, found.occurrence_id);
        return toolChangeText({
          changed: [
            `Removed: ${found.title} on ${found.date} is gone entirely — nothing was scheduled that day, so that entry only existed because it was logged.`,
          ],
          next: ['Confirm it without apologising at length.'],
        });
      }

      const raw = (params.metrics ?? {}) as Record<string, unknown>;
      const named: Record<string, number> = {};
      for (const [k, v] of Object.entries(raw)) {
        const n = Number(v);
        if (Number.isFinite(n) && Object.keys(named).length < 12) named[k.slice(0, 40)] = n;
      }
      if (!Object.keys(named).length) {
        return toolNothingChangedText('no corrected numbers were given and it was not marked as missed.', [
          'Ask what the right numbers were.',
        ]);
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
      return toolChangeText({
        changed: [`Corrected: ${found.title} on ${found.date} now reads ${summary}.`],
        next: ['Confirm it back.'],
      });
    },
  }),

  update_constraint: UPDATE_CONSTRAINT,
  // Tail tier (the drawer), not ALWAYS_ACTIONS: corrections to gear are occasional, and the
  // 2026-08-31 failure was the tool not EXISTING, not the drawer not surfacing it.
  update_equipment: UPDATE_EQUIPMENT,

  open_week_review: OPEN_WEEK_REVIEW,
  build_next_week: BUILD_NEXT_WEEK,
  // Tail tier (the drawer), not ALWAYS_ACTIONS — new tools default to the tail plus a hook
  // (owner ruling 2026-08-30, coach-tool-tiers.ts); promotion needs its own ruling and an
  // eval:tools run. The two plan FACADES (coach-action-plan-facade.ts, owner 2026-09-15: "Build
  // the plan facade so we stop raising the cap") front five tools that used to be registered
  // here one by one — extend_horizon, build_week_ahead and pause_week behind `shape_week`;
  // revise_session (PLAN-CHANGES.md rung 1) and start_replan (rung 3) behind `rebuild`. The
  // originals keep their files, contracts and tests; only the door changed.
  shape_week: SHAPE_WEEK,
  rebuild: REBUILD,
  // Tail tier, same ruling. The trail's hold menu from chat (owner, 2026-09-15: "she should be
  // able to adjust the calendar and the plan"): ONE dated session moved, copied or taken off,
  // at once — the calendar layer, where propose_plan_change edits the rules.
  edit_calendar: EDIT_CALENDAR,

  log_meal: LOG_MEAL,
  // Tail tier (the drawer), not ALWAYS_ACTIONS: a doctor's number arrives once and then holds for
  // months, which is the checklist's "changes data, weekly or rarer" row. Owner ruling 2026-09-01
  // — the reference intakes stay a lookup, and this is the one path that may stand in for them.
  set_micro_target: SET_MICRO_TARGET,

  propose_progress_layout: PROPOSE_PROGRESS_LAYOUT,
  // Tail tier (the drawer), not ALWAYS_ACTIONS: recording where someone lives is a once-in-a-while
  // moment, the checklist's "changes data, weekly or rarer" row. Closes the gap left by retiring
  // date-context.ts's "ask once, warmly" nudge — the coach now has an explicit, consented write
  // path for a location volunteered in chat, instead of only Settings and ambient capture.
  set_home_location: SET_HOME_LOCATION,
  // Tail tier (the drawer), not ALWAYS_ACTIONS: the write half of follow-ups (HARNESS-V3 C3).
  // Most days she notes nothing; the open list is dossier and rides every turn regardless.
  note_follow_up: NOTE_FOLLOW_UP,
  close_follow_up: CLOSE_FOLLOW_UP,
  update_repertoire: UPDATE_REPERTOIRE,
  // Tail tier (the drawer), not ALWAYS_ACTIONS: laying out a book is a once-per-book moment, the
  // checklist's "changes data, weekly or rarer" row — and it changes LESS than that, since it
  // writes no repertoire row at all. Sits beside update_repertoire so the pair is one filing:
  // individual pieces are written straight, a whole collection goes up for the person to tick.
  offer_repertoire_review: OFFER_REPERTOIRE_REVIEW,
  // Tail tier (the drawer), not ALWAYS_ACTIONS — new tools default to the tail plus a hook (owner
  // ruling 2026-08-30). It writes no answer of its own: the card composes an ordinary user message
  // and the person sends it, so this is "changes data" only in the sense that a question is now on
  // their screen. The persona has offered a questionnaire since v2 and there was no such surface.
  send_questionnaire: SEND_QUESTIONNAIRE,

  log_session: defineAction({
    name: 'log_session',
    mutates: 'immediate',
    description:
      'Write down how a session went, in their own words, and mark it done. {gate}. Use when they tell you about one — "that run was good but my HR was all over the place" — because that IS how a session gets logged: they finish it, they come to talk, and talking about it is the record. Use it again to REVISE something already logged when they add or correct it later. Their report is parsed and kept on that session, so it outlives the conversation and the weekly check-in can read it back. Read get_active_plan or get_recent_logs to name the session as the plan lists it. Pass {"session": "Long run", "report": "77 minutes, felt strong for the first hour, HR high on the hills", "date": "2026-08-15"}.',
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
      if (!query)
        return toolNothingChangedText('no session was named, so nothing was written down.', [
          'Ask which one they mean.',
        ]);
      if (!report)
        return toolNothingChangedText('there was nothing to write down.', ['Ask how it actually went, then log that.']);
      const date = String(params.date ?? '').trim();

      const rows = await listRecentForLogging(userId);
      const scoped = date ? rows.filter((r) => r.date === date) : rows;
      const found = matchActivity(scoped, query);
      if (!found) {
        const recent = rows
          .slice(0, 5)
          .map((r) => `${r.date} ${r.title}`)
          .join('; ');
        return toolNothingChangedText(
          `no session clearly matches "${query}"${date ? ` on ${date}` : ''}, so nothing was written down. Recent ones: ${recent || 'none'}.`,
          ['Ask which they mean.'],
        );
      }

      const logged = await logOccurrence(userId, found.occurrence_id, report);
      if (!logged)
        return toolActionFaultText('That could not be written down', 'tell them plainly and offer to try again.');
      return toolChangeText({
        changed: [
          `Logged against ${found.title} (${found.date})${found.logged ? ', replacing what was there' : ' and marked done'}: ${logged.summary}`,
        ],
        next: ['It is on their file.'],
      });
    },
  }),

  set_macro_targets: defineAction({
    name: 'set_macro_targets',
    mutates: 'immediate',
    description:
      'Set or adjust the daily calorie and macro targets their eating is coached against. {gate}. Use to establish targets once you have worked them out together, and — the part that matters most — to ADJUST them when the evidence says they are not doing their job: get_macro_targets reports the actual weekly weight change against a safe rate, and if they are following the numbers and not moving, or moving too fast to be healthy, changing the numbers is the coaching. Say what you changed and why. Never set a calorie target you would not defend out loud; the safety bounds you plan by apply here too. Pass {"kcal": 2100, "protein_g": 150, "carbs_g": 220, "fat_g": 70, "why": "losing 1.1kg/wk is faster than is safe for you — adding 200 back"}.',
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
        return toolNothingChangedText(
          'no reason was given. A target nobody can explain later is a number they will not keep — say why, then set it.',
        );

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
        return toolNothingChangedText(
          'those numbers did not survive the safety check (calories must be a realistic daily figure).',
          ['Work out something you would defend, then set it.'],
        );
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
      return toolChangeText({
        changed: [
          `Targets are now ${said}${wasKcal ? ` (was ${String(wasKcal)} kcal)` : ''}, and today's numbers already count against them.`,
        ],
        next: [
          'Tell them what changed and why — this is the adjustment they are paying you for, so it should sound like a decision you made, not a setting that moved.',
        ],
      });
    },
  }),
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
