import { buildWeekAhead } from './week-build.ts';
import { defineAction, type CoachActionTool } from './coach-action-types.ts';
import { toolChangeText, toolNothingChangedText } from './tool-response.ts';

/**
 * `build_week_ahead` — "build next week" before the check-in (owner, 2026-09-09: "the coach can
 * do whatever she wants — she can build next week, she can run the check-in, she can help the
 * user skip a check-in, everything from chat").
 *
 * The days past the check-in are locked on the trail because the check-in can redefine them.
 * This is the conversational road to opening them early: the following week is written on the
 * rhythm they already have, and the check-in date does NOT move — it still asks when it arrives.
 * Distinct from the two neighbours by what happens to the check-in: `build_next_week` ends a
 * finished week (skips the check-in, clock resets); `extend_horizon` runs THIS week longer (the
 * check-in moves with it). This one leaves it exactly where it is.
 *
 * Thin by contract: `buildWeekAhead` (week-build.ts) owns the guard, the materialization and the
 * `built_through` write. This file only translates its outcomes into what she should say.
 */
export const BUILD_WEEK_AHEAD: CoachActionTool = defineAction({
  name: 'build_week_ahead',
  mutates: 'immediate',
  description:
    'Write NEXT week now, before their weekly check-in, on the rhythm they already have — every commitment unchanged. Use it when they ask to see or plan the days past their check-in ("build next week", "what does next week look like", a locked day they want open). {gate}: those days open on their trail. Their check-in date does NOT move and still asks when it arrives. No parameters. It never redesigns — a changed week is propose_plan_change; a week that is already over rolls forward with build_next_week (this refuses then); running this week itself longer is extend_horizon. It refuses safely with no plan.',
  parameters: { properties: {} },
  async run(userId) {
    const result = await buildWeekAhead(userId);

    if (result.status === 'no_plan') {
      return toolNothingChangedText(
        'they have no active plan, so there is no rhythm to write next week from — nothing was built.',
        ['Offer to build them a first week (the build card) instead.'],
      );
    }
    if (result.status === 'due') {
      return toolNothingChangedText(
        'their week is already over, so this is not a build-ahead. build_next_week rolls the finished week forward unchanged (the skipped check-in), or open_week_review runs the check-in first.',
      );
    }
    if (result.status === 'already_built') {
      return toolNothingChangedText(
        `next week was already built, through ${result.builtThrough}. Those days are already open on their trail.`,
      );
    }
    return toolChangeText({
      changed: [
        `next week is written through ${result.builtThrough}, on the same rhythm. Those days are open on their trail now.`,
      ],
      unchanged: ['their commitments, and their check-in — it stays on its day.'],
      next: [
        'Say that next week is there to look at. Do not recite what is in it, and do not put up a build card — it is already built.',
      ],
    });
  },
});
