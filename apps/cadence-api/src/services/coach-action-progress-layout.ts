import { composeProgressLayout } from './progress-layout-compose.ts';
import type { CoachActionTool } from './coach-action-types.ts';

/**
 * `propose_progress_layout` — the progress talk's one write (docs/cadence/PROGRESS-ENGINE.md "The
 * progress talk"): the coach's compact read of what the user just said progress means to them
 * becomes a proposed page, shown as a card, never applied until they confirm it.
 *
 * Own file from day one, same reason `open_week_review` earned one (coach-action-week-review.ts):
 * this tool's own contract is delicate enough to want room, and coach-actions.ts is already near
 * its size gate.
 *
 * The tool does exactly one thing — compose and store a DRAFT layout — and that is deliberate,
 * same shape as `open_week_review`: a tool call never reaches the browser, so the only way the
 * client learns a card is due is by polling for what this call wrote. Calling it is what makes
 * "the user now has a proposal card" true (TOOL-HARNESS.md §5) — there is no second step.
 *
 * Registered ALWAYS-ON (owner ruling): reshaping what your own coaching page watches is a core
 * capability, not a rare one, and TOOL-HARNESS.md's own measurement of `update_constraint`
 * (found every time behind `find_tools`, called 0 of 3) is the argument against leaving an act
 * like this one round-trip away.
 */
export const PROPOSE_PROGRESS_LAYOUT: CoachActionTool = {
  name: 'propose_progress_layout',
  description:
    'Propose a new Progress page for them to look at, built from what they just told you progress means to them. Use it the moment they ask their Progress page to watch something different, or tell you in their own words what progress looks like to them ("I don\'t care about a streak, I want to see the pages I have written"). This does NOT change anything on their Progress page today — it puts up a proposal card, and their page stays exactly as it is until they tap to accept it. Pass {"what_they_want": "wants to see pages written, not a daily streak"}. Say ONE short line that the proposal is up, then STOP: do not describe the sections yourself — the card is about to show them, and you have not composed it.',
  parameters: {
    properties: {
      what_they_want: {
        type: 'string',
        description:
          'Your own compact summary of what they said progress means to them, in plain words — never a verbatim quote and never your own guess at what they SHOULD track. Required.',
      },
    },
    required: ['what_they_want'],
  },
  async run(userId, params) {
    const whatTheyWant = String(params.what_they_want ?? '').trim();
    if (!whatTheyWant) {
      return 'No description of what they want was given, so nothing was proposed. Ask them what progress looks like to them, in their own words, then call this again.';
    }

    const result = await composeProgressLayout(userId, whatTheyWant).catch(() => null);
    if (!result) {
      return 'That could not be composed just now — tell them plainly and offer to try again in a moment.';
    }

    if (!result.ok) {
      return [
        'NOT proposed — the composition did not pass its own checks:',
        ...result.reasons.map((r) => `- ${r}`),
        'Tell them plainly, in your own words, that it did not come together this time (never read the list above aloud) and offer to try again — maybe with a bit more of what they meant.',
      ].join('\n');
    }

    return [
      'Done — the user now has a "Progress page" proposal card on their screen, built from what they just told you.',
      'It is up for them to look at. Do not describe any of the sections — you have not seen the card, they are about to. Wait for them to look and tell you what stood out, then talk it through from there. Their current page has not changed and will not until they accept it.',
    ].join('\n');
  },
};
