import { randomUUID } from 'node:crypto';
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
import {
  getUser,
  mergeCapturedConstraints,
  removeCapturedConstraint,
  setMacroTargets,
  setPendingPlan,
} from '../repos/users.ts';
import { sanitizeTargets } from './nutrition-day.ts';

/** Today, YYYY-MM-DD — stamped on a target change so the weekly review throttle can see it. */
const today = (): string => new Date().toISOString().slice(0, 10);
import { expandRecurrence } from './scheduling.ts';
import { applyPlanEdits, matchActivity, type PlanEdit } from './plan-edit.ts';
import { sameConstraint } from './constraint-merge.ts';

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

export interface CoachActionTool {
  name: string;
  description: string;
  parameters: { properties: Record<string, unknown>; required?: string[] };
  /** Returns the text the model sees. Never throws for user-facing failure — it explains instead. */
  run(userId: string, params: Record<string, unknown>): Promise<string>;
}

const EDIT_SCHEMA = {
  type: 'array',
  description: 'The changes to make, applied in order.',
  items: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        enum: ['move', 'retime', 'resize', 'remove', 'add', 'rework'],
        description:
          'move = which days it happens on; retime = what time of day; resize = how many minutes; remove = drop it; add = a new commitment; rework = change what the session CONTAINS, keeping its slot (swap an exercise, change the focus).',
      },
      activity: {
        type: 'string',
        description: 'Which commitment to change, by its title exactly as the plan lists it. Not used for add.',
      },
      days: {
        type: 'array',
        items: { type: 'string' },
        description: 'For move and add: the days, e.g. ["friday"] or ["monday","thursday"].',
      },
      time_of_day: { type: 'string', description: 'For retime and add, e.g. "07:00" or "evening".' },
      duration_min: { type: 'integer', description: 'For resize and add: minutes per session.' },
      title: {
        type: 'string',
        description:
          'For add: what the new commitment is called. For rework: a new name, only if the change earns one.',
      },
      how_to: {
        type: 'string',
        description:
          'For rework: what this session should contain from now on, in plain words — "dead hangs instead of farmers carries for the grip work". Applies to every future session of it, not just the next one.',
      },
      goal_title: { type: 'string', description: 'For add: which goal it serves, by title.' },
      why: { type: 'string', description: 'For add: one sentence on why it is worth doing.' },
    },
    required: ['action'],
  },
};

function asEdits(raw: unknown): PlanEdit[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
    .map((e) => ({
      action: String(e.action ?? '') as PlanEdit['action'],
      ...(typeof e.activity === 'string' ? { activity: e.activity } : {}),
      ...(Array.isArray(e.days) ? { days: e.days.map(String) } : {}),
      ...(typeof e.time_of_day === 'string' ? { time_of_day: e.time_of_day } : {}),
      ...(e.duration_min != null ? { duration_min: Number(e.duration_min) } : {}),
      ...(typeof e.title === 'string' ? { title: e.title } : {}),
      ...(typeof e.how_to === 'string' ? { how_to: e.how_to } : {}),
      ...(typeof e.goal_title === 'string' ? { goal_title: e.goal_title } : {}),
      ...(typeof e.why === 'string' ? { why: e.why } : {}),
    }))
    .filter((e) => ['move', 'retime', 'resize', 'remove', 'add', 'rework'].includes(e.action));
}

export const COACH_ACTION_TOOLS: Record<string, CoachActionTool> = {
  propose_plan_change: {
    name: 'propose_plan_change',
    description:
      'Propose a specific change to the plan they already have — move a session to other days, retime it, resize it, drop it, add one, or rework what one CONTAINS (swap an exercise). This does NOT change anything: it works out the resulting week and shows a card with an Apply button, so the plan moves only when they tap. Use it the moment they name a change, in the same reply — never describe what you could do instead of doing it, never make them say it twice, never claim it is done before the tap. Read get_active_plan first and name commitments exactly as it lists them; a whole rebuild is the build card. Pass {"edits": [{"action": "move", "activity": "Easy run", "days": ["friday"]}]}, or {"edits": [{"action": "rework", "activity": "Grip finisher", "how_to": "Dead hangs, not farmers carries"}]}.',
    parameters: { properties: { edits: EDIT_SCHEMA }, required: ['edits'] },
    async run(userId, params) {
      const edits = asEdits(params.edits);
      if (!edits.length) return 'No usable changes were given, so nothing was proposed. Ask what they want changed.';

      const plan = await getActivePlan(userId);
      if (!plan) {
        return 'They have no active plan yet, so there is nothing to change — offer to build one (the build card) instead.';
      }
      const [activities, goals] = await Promise.all([
        listActivities(plan.plan_id),
        listGoalsByStatus(userId, ['committed', 'confirmed']),
      ]);
      const goalTitleById: Record<string, string> = {};
      for (const g of goals) goalTitleById[g.goal_id] = g.title;

      const { activities: next, changes, rejected } = applyPlanEdits(activities, edits, goalTitleById);
      if (!changes.length) {
        return [
          'Nothing could be changed:',
          ...rejected.map((r) => `- ${r}`),
          'Tell the user plainly what you could not find, and ask them which commitment they meant.',
        ].join('\n');
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
        'Proposed — the user now has a card showing exactly this, with an Apply button:',
        ...changes.map((c) => `- ${c}`),
        ...(rejected.length ? ['Could not do:', ...rejected.map((r) => `- ${r}`)] : []),
        'Say in one line what you have put up and that it is theirs to apply. Do NOT claim it is done or scheduled — it is not, until they tap it.',
      ].join('\n');
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
            'The corrected numbers, e.g. {"distance_km": 5, "duration_min": 28} — these replace the old ones. Required unless not_done is true.',
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
      const value: Record<string, number> = {};
      for (const [k, v] of Object.entries(raw)) {
        const n = Number(v);
        if (Number.isFinite(n) && Object.keys(value).length < 12) value[k.slice(0, 40)] = n;
      }
      if (!Object.keys(value).length) {
        return 'No corrected numbers were given and it was not marked as missed, so nothing changed. Ask what the right numbers were.';
      }
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

  update_constraint: {
    name: 'update_constraint',
    description:
      'Record a change to something the user works around — a knee, a night shift, a hard stretch. Takes effect immediately. Use when one has EASED ("my knee is fine now" → lift, which keeps it on file as quiet so you still know it happened), FLARED again (flare), or is genuinely NEW (add). Use remove ONLY when they say it was recorded wrongly and was never true ("I have never had a knee injury") — an error to erase, not history to keep; recovering from something is never a reason to remove it. Read get_constraints first and name it as listed. Pass {"constraint": "left knee", "action": "lift"}, or {"constraint": "night shifts", "action": "add", "kind": "life", "plan_around": true, "until": "2026-09-30"}.',
    parameters: {
      properties: {
        constraint: { type: 'string', description: 'Which one, by its label as get_constraints lists it.' },
        action: {
          type: 'string',
          enum: ['add', 'lift', 'flare', 'remove'],
          description:
            'add = something new they work around; lift = it has eased, keep it on file as quiet; flare = it is back; remove = it was recorded wrongly and was never true.',
        },
        kind: {
          type: 'string',
          enum: ['physical', 'life', 'other'],
          description: 'For add: a body thing, a life thing, or neither. Defaults to other.',
        },
        plan_around: {
          type: 'boolean',
          description: 'Whether the plan must work around it. Defaults to true for add and flare.',
        },
        until: {
          type: 'string',
          description: 'YYYY-MM-DD it stops applying, when they said so. Omit for open-ended.',
        },
      },
      required: ['constraint', 'action'],
    },
    async run(userId, params) {
      const label = String(params.constraint ?? '').trim();
      const action = String(params.action ?? '');
      if (!label) return 'No constraint was named, so nothing changed. Ask which one they mean.';

      if (action === 'remove') {
        const removed = await removeCapturedConstraint(userId, label);
        return removed
          ? `Removed "${label}" — it is off their file entirely, as something recorded in error. Say so briefly and move on; do not dwell on the mistake.`
          : `Nothing on file matches "${label}", so nothing was removed. Tell them plainly it was not there.`;
      }

      const known = ((await getUser(userId))?.baseline?.constraints ?? []) as Array<{ label: string }>;
      const existing = known.find((c) => sameConstraint(c.label ?? '', label));
      if (action !== 'add' && !existing) {
        const names = known.map((c) => c.label).join(', ') || 'none on file';
        return `Nothing on file matches "${label}", so nothing changed. What they work around: ${names}. Ask which they mean, or add it if it is new.`;
      }

      const planAround = typeof params.plan_around === 'boolean' ? params.plan_around : action !== 'lift';
      const kind = ['physical', 'life', 'other'].includes(String(params.kind)) ? String(params.kind) : undefined;
      const until = /^\d{4}-\d{2}-\d{2}$/.test(String(params.until ?? '')) ? String(params.until) : undefined;

      await mergeCapturedConstraints(userId, [
        {
          id: randomUUID(),
          label: existing?.label ?? label,
          plan_around: planAround,
          status: action === 'lift' ? 'quiet' : 'active',
          ...(kind ? { kind: kind as 'physical' | 'life' | 'other' } : {}),
          ...(until ? { until } : {}),
        },
      ]);

      if (action === 'lift') {
        return `"${existing?.label ?? label}" is marked eased — still on file, so you keep knowing about it, but the plan no longer has to work around it. Say that back plainly, and if their week was built around it, offer to rebuild.`;
      }
      if (action === 'flare') {
        return `"${existing?.label ?? label}" is active again and the plan should work around it. Say so, and offer to change the week if it currently ignores it.`;
      }
      return `Noted: they work around "${label}". Say it back in one line so they can correct you if you have it wrong.`;
    },
  },

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
