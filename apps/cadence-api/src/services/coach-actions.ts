import { getActivePlan } from '../repos/plans.ts';
import { listActivities } from '../repos/activities.ts';
import { listGoalsByStatus } from '../repos/goals.ts';
import { setPendingPlan } from '../repos/users.ts';
import { applyPlanEdits, type PlanEdit } from './plan-edit.ts';

/**
 * The coach's ACTION tools — the half of the harness that changes something.
 *
 * One rule holds the whole design up: **nothing here commits anything.** An action tool writes a
 * PROPOSAL (the user's `pending_plan`, which is by definition uncommitted) and returns a summary
 * for the coach to speak. The plan only changes when the person taps Apply, which runs the same
 * `POST /plan/lock` path a first build runs. Suggest-never-auto-apply is therefore structural
 * rather than a rule the model is asked to remember: there is no code path from a tool call to a
 * committed plan.
 *
 * Two more properties worth keeping:
 * - The card renders what the TOOL computed, not what the coach said it computed. The diff is
 *   read back from the stored proposal, so a turn that describes the change wrongly still shows
 *   the person the truth before they agree to it.
 * - The edits are applied in code (plan-edit.ts), so the change that lands is exactly the change
 *   that was asked for — no re-synthesis quietly rewriting the rest of the week.
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
        enum: ['move', 'retime', 'resize', 'remove', 'add'],
        description:
          'move = which days it happens on; retime = what time of day; resize = how many minutes; remove = drop it; add = a new commitment.',
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
      title: { type: 'string', description: 'For add: what the new commitment is called.' },
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
      ...(typeof e.goal_title === 'string' ? { goal_title: e.goal_title } : {}),
      ...(typeof e.why === 'string' ? { why: e.why } : {}),
    }))
    .filter((e) => ['move', 'retime', 'resize', 'remove', 'add'].includes(e.action));
}

export const COACH_ACTION_TOOLS: Record<string, CoachActionTool> = {
  propose_plan_change: {
    name: 'propose_plan_change',
    description:
      'Propose a specific change to the plan the user already has — move a session to other days, change its time, make it longer or shorter, drop it, or add one. This does NOT change anything: it works out what the week would become and shows them a card with an Apply button, so the plan moves only when they tap. Use once you have settled on a concrete adjustment, and never say it is done before they apply it. Read get_active_plan first and name commitments exactly as it lists them. For a wholesale rebuild around something new in their life, use the build card instead. Pass {"edits": [{"action": "move", "activity": "Easy run", "days": ["friday"]}]}.',
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
