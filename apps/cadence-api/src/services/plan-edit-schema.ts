/**
 * `propose_plan_change`'s `edits` parameter — the JSON schema the model actually reads, split out
 * of coach-actions.ts (at its own size gate) because this is a large, self-contained SHAPE
 * definition, not orchestration logic. Nothing about where the model sees it changes: it still
 * reaches her through `COACH_ACTION_TOOLS.propose_plan_change`, which imports `EDIT_SCHEMA` from
 * here, and `plan-edit-contract.test.ts` still reads it back the same way — through the tool
 * definition, never a direct import — so the contract test cannot drift from what ships regardless
 * of which file defines it.
 */

/** The actions the engine can carry out. One list, shared with the schema so they cannot drift. */
export const PLAN_EDIT_ACTIONS = ['move', 'retime', 'resize', 'remove', 'add', 'rework'] as const;

export const EDIT_SCHEMA = {
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
          'WHICH commitments, by the handles get_active_plan prints (e.g. ["a3f19c2b","5d01f807"]). Several in one edit is how you change every run at once. Not used for add. A commitment this call or the standing card created is "new1", "new2"… in card order — address it by that until the card is applied.',
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
      reason: {
        type: 'string',
        description:
          'A one-line human why for THIS edit, shown on the card under that swap — e.g. "You\'ve made 4 of 4 morning sessions this month and 1 of 4 evening ones." Give one whenever the edit follows a pattern you noticed, not a plain request they made. Not offered when the edit is remove, since there is no row left to carry it. Optional, and capped at 200 characters.',
      },
      optional: {
        type: 'boolean',
        description:
          'True marks this ONE edit a take-it-or-leave-it offer: the card shows it unchecked, off by default, and it ships only if they turn it on themselves. Omit or pass false for anything you actually mean to happen — it then ships unless they turn it off. Not offered when the edit is remove; there is no row left to half-decline once it is gone.',
      },
    },
    required: ['action'],
  },
};
