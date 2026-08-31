import { getUser } from '../repos/users.ts';
import { previewReplan } from './replan.ts';
import { runInBackground } from './background.ts';
import type { CoachActionTool } from './coach-action-types.ts';

/**
 * `rebalance_week` — the middle size of plan change, which had no verb until 2026-08-31.
 *
 * The gap it closes, measured on the owner's own session that morning: "balance my week" /
 * "rebuild it" said three times, answered with per-session shuffling and one question per turn,
 * because the only whole-week option she could reach (the build card) carries no steer — her
 * reasoning about WHY the week should change could not reach the rebuild. Meanwhile
 * `previewReplan(userId, steer)` — a steered whole-week regeneration with its own preview card,
 * Apply button, pending recovery, and ready-push — had been driving the app's "Adjust my plan"
 * button all along. This tool is that same machinery, reachable from the conversation.
 *
 * Fire-and-forget by necessity: synthesis is measured in MINUTES (271s for four goals —
 * scripts/probe-replan-preview.ts), and a turn cannot hold a tool round open that long. The
 * work rides `runInBackground`; the user gets the same push and preview card the button flow
 * sends, and the return text tells the coach exactly what she may and may not claim.
 */
export const REBALANCE_WEEK: CoachActionTool = {
  name: 'rebalance_week',
  description:
    'Redraw the whole week around what the user asked for, carrying your steer — the middle size between propose_plan_change (one specific edit) and the build card (rebuild from scratch when goals or life changed). Use when they ask for a different SHAPE of week — "balance my week", "more cardio, less lifting", "mornings only" — and you have settled with them what should change. Runs in the background for a few MINUTES; the user gets a notification and a preview card with an Apply button when it is ready. Nothing changes until they tap Apply. Pass steer as one plain paragraph of what should change and why, carrying their words: {"steer": "Balance the week: strength Monday morning with the dumbbells, real cardio Tuesday, only the early run on Wednesdays since afternoons are out."}.',
  parameters: {
    properties: {
      steer: {
        type: 'string',
        description:
          "What should change about the week and why, in one plain paragraph, carrying the user's own words and every constraint you settled in this conversation.",
      },
      replace: {
        type: 'boolean',
        description:
          'Pass true ONLY when a preview card is already up and the user has asked for a different version — it discards that preview and draws a new one.',
      },
    },
    required: ['steer'],
  },
  async run(userId, params) {
    const steer = String(params.steer ?? '').trim();
    if (!steer) {
      return 'No steer was given, so nothing was started. Say what should change about the week — their words, plus what you settled together — and call this again.';
    }

    // A synthesis costs minutes and real money; never quietly stack a second on top of one the
    // user has not answered. `replace: true` is the deliberate overwrite (previewReplan stores
    // over the old pending plan).
    const pending = (await getUser(userId))?.pending_plan;
    if (pending && params.replace !== true) {
      return (
        'A previewed week is ALREADY waiting on their screen with an Apply button — nothing new was started. ' +
        'Ask whether they want to apply or dismiss that one first; if they want a different version instead, ' +
        'call this again with replace: true.'
      );
    }

    runInBackground('rebalance_week', previewReplan(userId, steer));

    return (
      'Started — the new week is being drawn up around your steer. It takes a few MINUTES: they will get a ' +
      'notification and a preview card with an Apply button when it is ready, and NOTHING changes until they tap it. ' +
      'Say one line: the rebalanced week is on its way and it is theirs to apply. Do NOT describe the new week — ' +
      'you have not seen it — and do NOT say the plan is changed.'
    );
  },
};
