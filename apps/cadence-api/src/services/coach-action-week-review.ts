import { getActivePlan } from '../repos/plans.ts';
import { setPendingWeekReview } from '../repos/users.ts';
import type { CoachActionTool } from './coach-action-types.ts';

/**
 * `open_week_review` — puts the week up on the user's own screen, the way a check-in should:
 * looked at, not recited.
 *
 * Own file from day one, same reason `update_constraint` earned one (coach-action-constraint.ts):
 * this tool's own contract is delicate enough to want room, and coach-actions.ts is already near
 * its size gate.
 *
 * The tool does exactly one thing — persist a POINTER to which plan week is due for review — and
 * that is deliberate. The chat wire is pure SSE prose; a tool call never reaches the browser. So
 * the only way the client learns a card is due is by polling for what this call wrote, the same
 * shape `propose_plan_change` already uses for `pending_plan`. Calling this tool is what makes "the
 * user now has a card" true (TOOL-HARNESS.md §5) — there is no second step, no tag, nothing else
 * that has to also happen for the card to exist.
 *
 * The window is the PLAN week, not a user-chosen range: `from` is the day the active plan was
 * generated, `to` is seven days later, capped at today so a week still in progress does not claim
 * days that have not happened yet. A windowed `review_period(from, to)` for "look back at last
 * month" is a later tool; this one answers "let's do my check-in" — the ordinary case.
 */
export const OPEN_WEEK_REVIEW: CoachActionTool = {
  name: 'open_week_review',
  description:
    'Put this week up on their screen for a check-in — the actual days, not a description of them. Use it the moment they ask to do their check-in, review their week, or look back at how the week went. This does NOT change anything in their plan or their log — it puts a "Week review" card on their screen, and the app draws every number from what they actually logged. Say one short line that it is up, then STOP: do not recite figures yourself — the card is about to show the real ones, and you have not read them. Wait for what they say once they have looked. If they have no active plan yet, it tells you so instead of putting up a card — offer to build one.',
  parameters: { properties: {} },
  async run(userId) {
    const plan = await getActivePlan(userId);
    if (!plan) {
      return 'They have no active plan yet, so there is no week to review — say so plainly and offer to build one (the build card) instead.';
    }

    // The plan week: `generated_at` may arrive as a Date rather than the string the type promises
    // (the exact mismatch TOOL-HARNESS.md is written around), so route it through `new Date(...)`
    // rather than string-slicing it directly — that works whichever shape postgres handed back.
    const genMs = new Date(plan.generated_at).getTime();
    const from = new Date(genMs).toISOString().slice(0, 10);
    const weekEnd = new Date(genMs + 7 * 86_400_000).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    const to = weekEnd < today ? weekEnd : today;

    await setPendingWeekReview(userId, { from, to, built_at: new Date().toISOString() });

    return [
      `Done — the user now has a "Week review" card on their screen covering ${from} to ${to}, drawn from what they actually logged.`,
      'Their week is up for them to look at. Do not describe any of the numbers — you have not seen them, the app has, and reciting a guess would contradict what they are about to read. Wait for them to look and tell you what stood out, then talk it through from there.',
    ].join('\n');
  },
};
