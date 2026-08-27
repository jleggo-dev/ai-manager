import { buildNextWeek } from './week-build.ts';
import type { CoachActionTool } from './coach-action-types.ts';

/**
 * `build_next_week` — the trust path gets a verb of its own.
 *
 * The protocol originally told her the app intercepts the say-text "Just build my week — I'm
 * good" and rolls the week forward itself. No such interception exists, and building one would be
 * brittle by design: say-texts land in the composer EDITABLE, so the exact-string match dies the
 * moment someone softens the phrasing. The honest mechanism is the same as every other act in
 * this harness — she recognizes the intent (however it is worded) and calls the tool.
 *
 * One deliberate asymmetry with the trail card's own "Just build my week" button: that button
 * calls POST /plan/week/build directly and never involves her. This tool exists for the paths
 * that run THROUGH the conversation — the late arrival's pick, the empty week's "fine, I just
 * didn't log", a check-in that ends with nothing worth changing.
 *
 * Thin by contract: `buildNextWeek` (week-build.ts) owns the guard, the commit, the session
 * warm-up, and the ready push. This file only translates its three outcomes into what she should
 * actually say.
 */
export const BUILD_NEXT_WEEK: CoachActionTool = {
  name: 'build_next_week',
  description:
    'Roll their SAME rhythm into next week — a plain carry-forward, no rebuild: their current commitments are recommitted unchanged, the new week\'s sessions get written in the background, and the app notifies them when it is ready. Takes effect immediately — the moment you call it next week is committed; no card, no tap. So call it only when they have plainly chosen to keep things as they are: "just build my week", a check-in ending with nothing to change, or an empty week they told you was fine. It never redesigns anything — a changed week is propose_plan_change (specific edits) or the build card (full rebuild). It refuses safely when their week is still running, or when there is no plan yet (offer the build card then). Afterwards say ONE short line that next week is on its way — never promise how long.',
  parameters: { properties: {} },
  async run(userId) {
    const result = await buildNextWeek(userId);

    if (result.status === 'no_plan') {
      return 'They have no active plan, so there is no rhythm to roll forward — nothing was built. Offer to build them a first week (the build card) instead.';
    }
    if (result.status === 'not_due') {
      return 'Their current week is still running, so nothing was rolled — this tool only ends a finished week. If something should change mid-week, propose_plan_change is the right size; otherwise their week simply continues.';
    }
    return [
      `Done — week ${result.version} is being built from the same rhythm, nothing changed. The sessions are being written in the background and the app will notify them when it is ready.`,
      'Say ONE short line that next week is on its way. Do not promise how long it will take, do not recite what is in it, and do not put up a build card — the build is already happening.',
    ].join('\n');
  },
};
