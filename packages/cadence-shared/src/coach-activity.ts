/**
 * What to SAY she is doing while she does it.
 *
 * Owner, 2026-08-16: *"when I use products in a harness like Claude, they usually tell me when
 * they're calling a tool. This would help us diagnose and it would also tell the user something is
 * happening (or happened)."* Both halves are right, and today made the case twice over — every
 * failure this week was invisible work. She said a session was logged and nothing was; she said a
 * constraint was removed and it was not. A line saying *"writing that down…"* followed by silence
 * is a question the user can ask. No line at all is not.
 *
 * **Behaviour, never the entity.** BRAND.md is explicit that the machinery stays hidden — to the
 * user there is only the coach — so this never prints a tool name. Claude Code says
 * `get_workout_history` because its user is a developer whose job is the tool. Cadence's user is
 * someone with a sore elbow, and "checking your recorded workouts" is both truer to them and the
 * same information. The tool name is in the `coach_tool` log for whoever is debugging.
 *
 * Present participles on purpose: this appears while the work is happening, and it should read as
 * a glance over her shoulder rather than a status code.
 */
const PHRASES: Record<string, string> = {
  get_active_plan: 'looking at your plan',
  get_workout_history: 'checking your recorded workouts',
  get_recent_logs: 'reading back your recent sessions',
  get_goal_progress: 'checking how your goals are going',
  get_practice_totals: 'adding up your practice',
  get_journal: 'reading your journal',
  get_equipment: 'checking what you have to work with',
  get_nutrition: 'checking your food',
  propose_plan_change: 'working out the change',
  log_session: 'writing that down',
  update_goal: 'updating your goal',
  update_constraint: 'updating what we work around',
  correct_log: 'fixing that record',
  set_macro_targets: 'setting your targets',
  // The meta tools are pure machinery. Naming them would be naming the harness, and "looking
  // something up" is what she is actually doing from where the user sits.
  find_tools: 'looking something up',
  use_tool: 'looking something up',
};

/** Anything unmapped — a new tool nobody has written a phrase for yet — still says something true. */
const FALLBACK = 'looking something up';

/**
 * One line for a round of tool calls. Several at once collapse to the first rather than listing:
 * a queue of activity reads as a machine working, and she is not a machine to this person.
 * Duplicates and unknowns are handled, so a mis-specced tool can never produce an empty line.
 */
export function coachActivityLine(names: string[]): string {
  const first = names.map((n) => PHRASES[n] ?? FALLBACK).find(Boolean);
  return first ?? FALLBACK;
}

/** The SSE frame the server writes so the client can show it. Not a content delta. */
export interface CoachActivityFrame {
  cadence: 'tool';
  names: string[];
}
