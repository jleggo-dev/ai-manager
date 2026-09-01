import { getUser } from '../repos/users.ts';
import { readPlanRun } from './plan-run.ts';
import { startReplanRun } from './replan-start.ts';
import type { CoachActionTool } from './coach-action-types.ts';

/**
 * `start_replan` — the coach's door onto the full background week-rebuild (Phase 2,
 * docs/cadence/PLAN-CHANGES.md rung 3). She has always had the scalpels — `propose_plan_change`
 * for structural edits, `revise_session` for one session's contents — but when someone asked for
 * the WEEK to be reshaped, the only honest answer was "go tap the Adjust button": the old
 * rebalance tool was deleted and nothing replaced it. This runs the exact spine the button runs
 * (`startReplanRun` — one claimable plan_run, stages stamped, proposal card + push at the end),
 * so the conversation and the sheet can never disagree about what a rebuild is.
 *
 * The return text only promises what the launched run itself delivers (TOOL-HARNESS.md rule 5):
 * previewReplan writes the pending card and sends the ready push; plan-run.ts persists and pushes
 * a failure. Nothing here depends on the coach also doing something.
 */

/** "started 3 min ago" / "started under a minute ago" — whole minutes, never arithmetic for her. */
function startedAgo(startedAt: string): string {
  const min = Math.floor((Date.now() - Date.parse(startedAt)) / 60_000);
  return min <= 0 ? 'started under a minute ago' : `started ${min} min ago`;
}

export const START_REPLAN: CoachActionTool = {
  name: 'start_replan',
  description:
    'Rebuild the user\'s WHOLE week around their words — a background redo of the plan itself. It takes a few minutes and ends in a card they tap to apply; does NOT change anything until that tap. Use it only when they ask for the week itself to be reshaped ("rebalance my week", "redo the whole thing, more recovery"). For anything smaller use the smaller tool: moving, resizing, dropping or adding commitments is propose_plan_change (instant card, no rebuild); changing what is inside one session is revise_session; rolling the same week forward unchanged is build_next_week. Pass {"steer": "more recovery, keep the long run"} — their own words for what the week should become, never your rewrite. If a rebuild is already running, calling again joins it instead of starting a second.',
  parameters: {
    properties: {
      steer: {
        type: 'string',
        description:
          'What the week should become, in THEIR words — the rebuild is shaped around this, so never substitute your summary for what they said.',
      },
    },
    required: ['steer'],
  },
  async run(userId, params) {
    const steer = String(params.steer ?? '').trim();
    if (!steer) {
      return 'No words were given to rebuild around, so nothing was started. Ask what they want the week to become, then pass exactly that.';
    }

    const outcome = await startReplanRun(userId, steer);

    if (outcome === 'joined') {
      /**
       * 'joined' means a FRESH run already holds the claim (claimPlanRun takes over anything
       * failed or stale), so no second synthesis fired and THIS call's steer went nowhere. The
       * age comes from the same record the client poll reads; if it cannot be read, saying less
       * beats guessing.
       */
      const run = readPlanRun(await getUser(userId).catch(() => null));
      const ago = run?.status === 'running' ? ` (${startedAgo(run.startedAt)})` : '';
      return [
        `A rebuild of their week is ALREADY being drawn up${ago} — no second one was started, and the words from this call were NOT used.`,
        'Tell them one is already in the works: the card with the reworked week will appear on their plan when it finishes, and a notification will reach them. If they asked for something different from what that rebuild is doing, they can look at the card first and ask again after.',
      ].join('\n');
    }

    return [
      `Started — their week is being rebuilt around "${steer}" in the background. It takes a few minutes.`,
      'Say in ONE short line: the rework is underway, a card with the reworked week will appear on their plan, and a notification will reach them when it is ready — they do not have to wait in this chat. Do NOT promise an exact time, do NOT describe the new week (it does not exist yet), and do NOT claim anything changed — nothing does until they apply the card.',
    ].join('\n');
  },
};
