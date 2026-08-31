import { extendHorizon, MAX_HORIZON_DAYS } from './plan-horizon.ts';
import type { CoachActionTool } from './coach-action-types.ts';

/**
 * `extend_horizon` — the answer to "can we plan two weeks ahead?" (owner, 2026-08-31).
 *
 * The 7-day horizon is deliberate (check-in rebuild, step 6: the week the user sees IS the week
 * that's materialized, and its edge is the check-in moment) — so this is an exception the user
 * asks for, never a default the app drifts back into. The trail's end-cap sends the ask through
 * the conversation visibly, and she grants it here; the grant lives on the plan row
 * (`horizon_days`, 0050), so the screen, the check-in flag, and the weekly push all move
 * together.
 *
 * Thin by contract, like build_next_week: `extendHorizon` (plan-horizon.ts) owns the guard, the
 * column write, and the top-up. This file only translates its outcomes into what she should say.
 */
export const EXTEND_HORIZON: CoachActionTool = {
  name: 'extend_horizon',
  description:
    'Run their CURRENT week longer instead of ending it on day seven — the "can we plan two weeks ahead?" ask. Pass the total length in days counted from the day the week began: {"days": 14} makes it a two-week stretch (28 is the most). Takes effect immediately — their weekly check-in moves to the new end date and the added days follow their existing rhythm unchanged; nothing is redesigned. Use it only when they have plainly asked to see or plan further ahead. It never shortens a week and never changes what is IN the week — specific edits are propose_plan_change, and rolling a finished week forward is build_next_week. It refuses safely when they have no plan yet.',
  parameters: {
    properties: {
      days: {
        type: 'number',
        description: 'Total length of the week in days, counted from the day it began — 14 for two weeks. Most is 28.',
      },
    },
    required: ['days'],
  },
  async run(userId, params) {
    const days = Math.trunc(Number(params.days));
    if (!Number.isFinite(days) || days < 1) {
      return 'No usable length was given, so nothing changed. Pass the total days the week should run — {"days": 14} for two weeks.';
    }
    if (days > MAX_HORIZON_DAYS) {
      return `${days} days is past the ${MAX_HORIZON_DAYS}-day most this can stretch a single week — nothing changed. That far ahead is a re-plan conversation, not a longer week.`;
    }

    const result = await extendHorizon(userId, days);

    if (result.status === 'no_plan') {
      return 'They have no active plan, so there is no week to extend — nothing changed. Offer to build them a first week instead.';
    }
    if (result.status === 'unchanged') {
      return `Their week already runs ${result.horizonDays} days (through ${result.endsOn}) — nothing changed. This tool only extends; if they want the week shorter or different, that is a check-in or propose_plan_change conversation.`;
    }
    return [
      `Done — their week now runs ${result.horizonDays} days, through ${result.endsOn}. The added days follow the same rhythm they already committed to, and their weekly check-in moved to the new end date.`,
      'Say ONE short line that the week now runs further ahead and when the check-in lands. This applies to the CURRENT week only — the next week they build returns to seven days unless they ask again.',
    ].join('\n');
  },
};
