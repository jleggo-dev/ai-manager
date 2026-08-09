/* ════════════════════════════════════════════════════════════════
   Which register a nudge speaks in
   ════════════════════════════════════════════════════════════════ */

import type { GoalArea } from '../types/baseline.ts';

/**
 * The four goal areas already exist (`movement | nourishment | mind | practice`) and this module
 * does NOT invent a fifth thing — it only answers "which sentence fits?".
 *
 * The distinction that actually matters in a nudge is mind-versus-body, and it matters because the
 * friction is different. "Kit by the door is the hard part" is true of a run and meaningless about
 * a sit; "before the house gets loud" is true of a sit and odd about a run. Everything else can
 * share a neutral line, so the register set is small on purpose: three registers, not four
 * near-duplicates that drift apart the first time someone edits one.
 *
 * Nothing here is user-facing. The area is a fact about the plan; the copy names the user's own
 * activity title and never the area (BRAND.md: "copy names the goal, not the area").
 */

export type NudgeRegister = 'body' | 'mind' | 'neutral';

const AREA_REGISTER: Record<GoalArea, NudgeRegister> = {
  movement: 'body',
  mind: 'mind',
  nourishment: 'neutral',
  practice: 'neutral',
};

/**
 * Title/category words that mean "this is a sitting-still practice" even when the activity is
 * filed elsewhere. Activities carry a free-text `category`, not an area, so plenty of real plans
 * have a meditation under `practice` — matching the words is the difference between the mind line
 * and a line about kit by the door.
 *
 * Deliberately narrow. A word that only sometimes means stillness (a "walk", a "practice") is left
 * out: the neutral register is always acceptable, and a wrong-register nudge is a coach that was
 * not listening.
 */
const MIND_WORDS =
  /\b(meditat\w*|mindful\w*|breath\w*|breathe|sit|sitting|stillness|journal\w*|pages|gratitude|pray\w*|prayer|reflect\w*)\b/i;

const BODY_WORDS =
  /\b(run|running|jog\w*|walk\w*|hike|hiking|ride|riding|cycl\w*|bike|biking|swim\w*|lift\w*|strength|gym|row\w*|stretch\w*|mobility|yoga|workout|session|train\w*|intervals?)\b/i;

/**
 * Resolve the register from whatever the caller happens to know: an explicit area (goal-derived,
 * most reliable), then the activity's category and title.
 *
 * Falls back to `neutral` rather than guessing — a sentence that fits every activity is a smaller
 * failure than a confident sentence about the wrong one.
 */
export function nudgeRegister(input: {
  area?: GoalArea | null;
  category?: string | null;
  title?: string | null;
}): NudgeRegister {
  const words = `${input.category ?? ''} ${input.title ?? ''}`;
  // Words win over the area: a "morning pages" activity filed under `practice` is still a mind
  // nudge, and the area is often absent on an activity row entirely.
  if (MIND_WORDS.test(words)) return 'mind';
  if (BODY_WORDS.test(words)) return 'body';
  if (input.area && AREA_REGISTER[input.area]) return AREA_REGISTER[input.area];
  return 'neutral';
}
