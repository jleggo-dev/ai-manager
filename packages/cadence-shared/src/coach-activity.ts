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
 *
 * NO THIRD-PERSON PRONOUNS. The coach speaks as "I" (BRAND.md), so a line reading "looking up what
 * SHE can check" is the app narrating her from outside — which is a different voice from the one
 * saying every other sentence on the screen, and the owner spotted it immediately. A bare
 * participle needs no pronoun at all; where one is unavoidable it is first person. Pinned by a
 * test, because this is the kind of thing that reads fine to whoever wrote it.
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
  // find_tools genuinely IS a search — reading the menu, not the meal.
  find_tools: 'looking up what I can check',
  // use_tool is never the real answer: see resolveActivityNames, which unwraps it to its target.
  use_tool: 'looking something up',
};

/** Every tool that has a phrase. Exported so a voice test can walk them all, not a copied subset. */
export const ALL_PHRASE_KEYS = Object.keys(PHRASES);

/** Anything unmapped — a new tool nobody has written a phrase for yet — still says something true. */
const FALLBACK = 'looking something up';

/**
 * Unwrap `use_tool` to the tool it is actually running.
 *
 * The phrase table was specific from the start — "checking your recorded workouts", "looking at
 * your plan" — but the user almost never saw those, and it took the owner saying so twice to find
 * out why. Most reads reach their tool THROUGH `use_tool`, so the name on the wire is the meta-tool
 * and every one of them printed the same "looking something up". The specificity was written, and
 * then thrown away one layer before the screen.
 *
 * Owner, 2026-08-21: *"we just say something like 'looking into it'. We should say 'calling the
 * build plan tool', 'pulling your health data'."* Right — and the fix is not more phrases, it is
 * looking through the indirection to the tool already in the table.
 *
 * Arguments are a JSON string off the provider, so they are parsed defensively: a malformed blob
 * must degrade to the honest generic line, never throw inside a status message.
 */
export function resolveActivityNames(calls: Array<{ name: string; arguments?: string | null }>): string[] {
  return calls.map((c) => {
    if (c.name !== 'use_tool') return c.name;
    try {
      const inner = JSON.parse(c.arguments || '{}') as { name?: unknown };
      const target = String(inner?.name ?? '').trim();
      return target || c.name;
    } catch {
      return c.name;
    }
  });
}

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
