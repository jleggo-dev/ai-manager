import { isCalendarDate } from '@cadence/shared';
import { retitleForTarget } from './goal-retitle.ts';
import { listGoals, updateGoal, setGoalStatus, retireGoal, restoreGoal } from '../repos/goals.ts';
import { insertGoalEvent } from '../repos/goal-events.ts';
import { matchActivity } from './plan-edit.ts';
import { defineAction, type CoachActionTool } from './coach-action-types.ts';
import { toolChangeText, toolNothingChangedText } from './tool-response.ts';

/**
 * `update_goal` — change one goal's number, date or standing, applied on the spot.
 *
 * Moved out of coach-actions.ts when that file crossed the 500-line gate again (HARNESS-V3 P5: every
 * return path now says what changed), the same way `update_constraint` moved out on 2026-08-17. Why
 * a goal is applied without a card is written at the top of coach-actions.ts.
 */

/** What a goal change leaves as it was: the week already built (an `unchanged:` line). */
const WEEK_BUILT_BEFORE =
  'their current week — it was built before this change and still holds the sessions it produced. rebuild (scope "week") rebuilds it.';

export const UPDATE_GOAL: CoachActionTool = defineAction({
  name: 'update_goal',
  mutates: 'immediate',
  description:
    'Change one of the user\'s goals: lower or raise the number they are aiming at, move the date, mark it finished, stop working on it, set it aside, or bring one back. Use when they have plainly decided one of those in words — never on your own read that a goal looks too hard, and never to tidy up. {gate}: a goal is one fact you can say out loud, so your sentence confirming it is the confirmation, and every change is written to the goal\'s own history. Name the goal exactly as get_objectives lists it — a set-aside goal will not be listed there; use the name they just said. Pass {"goal": "Read 100 books", "action": "retarget", "target": 50, "unit": "books"}, {"goal": "Run a 10k", "action": "redate", "date": "2026-11-01"}, or {"goal": "Obstacle race", "action": "retire"}.',
  parameters: {
    properties: {
      goal: { type: 'string', description: 'Which goal, by its title exactly as get_objectives lists it.' },
      action: {
        type: 'string',
        enum: ['retarget', 'redate', 'complete', 'stop', 'retire', 'restore'],
        description:
          'retarget = change the number they are aiming at; redate = change the date they are aiming for; complete = they finished it; stop = they are no longer working on it; retire = set it aside so it stops shaping the plan; restore = bring a set-aside goal back into the plan.',
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
    if (!query) return toolNothingChangedText('no goal was named.', ['Ask which goal they mean.']);

    const goals = await listGoals(userId);
    const live = goals.filter((g) => !['completed', 'abandoned'].includes(g.status));
    const goal = matchActivity(live, query);
    if (!goal) {
      const names = live.map((g) => g.title).join(', ') || 'none';
      return toolNothingChangedText(`nothing clearly matches "${query}". Their goals are: ${names}.`, [
        'Ask which one they mean.',
      ]);
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
        ? toolChangeText({ changed: [`Marked "${goal.title}" finished.`] })
        : toolChangeText({
            changed: [`Stopped "${goal.title}".`],
            unchanged: [WEEK_BUILT_BEFORE],
            next: ['Say it plainly and without any suggestion they failed.'],
          });
    }

    if (action === 'retire' || action === 'restore') {
      if (action === 'retire' && goal.status === 'parked') {
        return toolNothingChangedText(`"${goal.title}" is already set aside.`, ['Say so plainly.']);
      }
      if (action === 'restore' && goal.status !== 'parked') {
        return toolNothingChangedText(`"${goal.title}" is not set aside, so there is nothing to bring back.`);
      }
      const updated =
        action === 'retire' ? await retireGoal(userId, goal.goal_id) : await restoreGoal(userId, goal.goal_id);
      if (!updated) return toolNothingChangedText(`could not ${action} "${goal.title}".`, ['Try again.']);
      await insertGoalEvent(userId, {
        goal_id: goal.goal_id,
        kind: 'note',
        label: action === 'retire' ? `Set aside: ${goal.title}` : `Brought back: ${goal.title}`,
      }).catch(() => null);
      return action === 'retire'
        ? toolChangeText({
            changed: [`"${goal.title}" is set aside — it will not shape next week's plan.`],
            unchanged: ['everything it already built — that stays in Progress.', WEEK_BUILT_BEFORE],
            next: ['Say it plainly and without any suggestion they failed.'],
          })
        : toolChangeText({
            changed: [`"${goal.title}" is back. It will shape the plan again from the next build.`],
            unchanged: [WEEK_BUILT_BEFORE],
          });
    }

    if (action === 'retarget') {
      const target = Number(params.target);
      if (!Number.isFinite(target))
        return toolNothingChangedText('no new target number was given.', ['Ask what it should be.']);
      const unit = typeof params.unit === 'string' && params.unit.trim() ? params.unit.trim() : goal.measure?.unit;
      const was = goal.measure?.target;
      /**
       * Carry the number in the TITLE with it.
       *
       * Retarget wrote `measure.target` and left the title alone, so "Read 100 books this year"
       * kept saying 100 while the goal aimed at 50 — and the title is what every list, card and
       * prompt shows. The outcome eval's judge caught it on 2026-08-22 while the deterministic
       * assert passed, because the assert only checked the number it had just written.
       *
       * Rewritten ONLY where the old target appears as a standalone number, so "Read 100 books
       * this year" becomes "Read 50 books this year" and a title carrying no number, or a
       * different one, is left exactly as the user wrote it. Their words are theirs; the stale
       * digit is ours.
       */
      const retitled = retitleForTarget(goal.title, was, target);
      await updateGoal(userId, goal.goal_id, {
        measure: { ...goal.measure, target, ...(unit ? { unit } : {}) },
        ...(retitled ? { title: retitled } : {}),
      });
      await insertGoalEvent(userId, {
        goal_id: goal.goal_id,
        kind: 'note',
        label: `Target changed: ${String(was ?? '?')} → ${target}${unit ? ` ${unit}` : ''}`,
      }).catch(() => null);
      return toolChangeText({
        changed: [
          `"${retitled ?? goal.title}" now aims at ${target}${unit ? ` ${unit}` : ''} (was ${String(was ?? 'unset')}).`,
        ],
        unchanged: [WEEK_BUILT_BEFORE],
        next: ['Say what changed.'],
      });
    }

    const date = String(params.date ?? '').trim();
    if (!isCalendarDate(date)) {
      return toolNothingChangedText('no usable date was given.', ['Ask what date they are aiming for.']);
    }
    const wasDate = goal.timeframe?.end;
    await updateGoal(userId, goal.goal_id, { timeframe: { ...goal.timeframe, end: date } });
    await insertGoalEvent(userId, {
      goal_id: goal.goal_id,
      kind: 'note',
      label: `Date moved: ${wasDate ?? 'unset'} → ${date}`,
    }).catch(() => null);
    return toolChangeText({
      changed: [`"${goal.title}" now aims at ${date} (was ${wasDate ?? 'no date'}).`],
      unchanged: [
        'their plan — it still holds the sessions built for the old date. get_active_plan shows them; rebuild (scope "week") rebuilds the week.',
      ],
      next: ['Say what changed.'],
    });
  },
});
