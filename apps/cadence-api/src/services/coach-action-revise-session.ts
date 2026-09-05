import { listUpcomingForRevision } from '../repos/occurrence-sessions.ts';
import { reviseSession } from './session-generate.ts';
import { matchActivity } from './plan-edit.ts';
import type { CoachActionTool } from './coach-action-types.ts';

/**
 * `revise_session` — the coach's scalpel for "add chest and abs to today's workout" said in chat
 * (docs/cadence/PLAN-CHANGES.md, rung 1 of the ladder). The 2026-08-31 incident: this exact ask
 * had no home, so it fell through to a full multi-minute plan re-synthesis and died at the
 * transport timeout. It is a SESSION-CONTENT ask — one prescription, ~34s — and this tool routes
 * it there: `reviseSession` (session-generate.ts) rebuilds ONE upcoming session with the person's
 * words folded into the prescription, and nothing else about the plan moves.
 *
 * Addressing mirrors log_session/correct_log exactly: a title as the plan lists it plus an
 * optional date, matched with the same one-or-nothing `matchActivity` — ambiguity is a rejection,
 * never a coin flip. The list it matches against floors at today (you cannot rebuild the past)
 * the way logging's list is ceilinged at today (you cannot log the future).
 */
export const REVISE_SESSION: CoachActionTool = {
  name: 'revise_session',
  description:
    'Rebuild what is INSIDE one upcoming session from their words — "add chest and abs to today\'s workout", "make tomorrow\'s run easier on my knee". Takes effect immediately: the session is reprogrammed around what they asked and is on their plan when you reply. Use it when they want the work within a session different; moving, resizing, or dropping the session itself is propose_plan_change, and reshaping the whole week is start_replan. Pass {"session": "Strength", "steer": "add chest and abs", "date": "2026-09-01"} — "session" names it as the plan lists it, "steer" carries their words, and omitting "date" takes the soonest one coming up. Only a session still to do, today or later, can be rebuilt; a wrong record of a finished one is correct_log.',
  parameters: {
    properties: {
      session: { type: 'string', description: 'Which session, by the title the plan lists.' },
      steer: {
        type: 'string',
        description: 'What should be different about it, in THEIR words — never your rewrite of what they asked.',
      },
      date: {
        type: 'string',
        description:
          'The day it is scheduled, as YYYY-MM-DD — "today\'s workout" is today. Omit to take the soonest upcoming one.',
      },
    },
    required: ['session', 'steer'],
  },
  async run(userId, params) {
    const query = String(params.session ?? '').trim();
    const steer = String(params.steer ?? '').trim();
    if (!query) return 'No session was named, so nothing changed. Ask which one they mean.';
    if (!steer) return 'No change was described, so nothing changed. Ask what they want different about it.';
    const date = String(params.date ?? '').trim();

    const rows = await listUpcomingForRevision(userId);
    const scoped = date ? rows.filter((r) => r.date === date) : rows;
    const found = matchActivity(scoped, query);
    if (!found) {
      const upcoming = rows
        .slice(0, 5)
        .map((r) => `${r.date} ${r.title}`)
        .join('; ');
      return `No upcoming session clearly matches "${query}"${date ? ` on ${date}` : ''}, so nothing changed. Coming up: ${upcoming || 'none'}. Ask which they mean.`;
    }

    const result = await reviseSession(userId, found.occurrence_id, steer);
    if (result.status === 'not_found') {
      return 'That session vanished before it could be rebuilt — their plan may have just changed. Nothing happened; read get_active_plan and go again from what it lists.';
    }
    if (result.status === 'not_revisable') {
      if (result.reason === 'system_row') {
        return 'That row is a tracking entry the app manages (a weigh-in, a food log) — there is no programmed session inside it to rebuild. Nothing changed.';
      }
      if (result.reason === 'past') {
        return `${found.title} on ${found.date} is in the past — a day that already happened is history, not a plan. Nothing changed; if the record of it is wrong, correct_log is the fix.`;
      }
      return `${found.title} on ${found.date} is already recorded, so its session is history now and was left alone. If the record is wrong, correct_log is the fix.`;
    }
    if (result.status === 'failed') {
      return 'The rebuild did not come back usable and nothing new was written — that session will be drawn up fresh the next time they open it. Tell them plainly and offer to try again with the same words.';
    }

    const { session } = result;
    const steps = session.blocks.reduce((n, b) => n + b.items.length, 0);
    return [
      `Rebuilt: ${found.title} on ${found.date} now holds ${session.blocks.length} block(s), ${steps} step(s), built around "${steer}".`,
      `The new session's note: "${session.note}"`,
      'It is already on their plan — nothing to tap. Say what changed and why it fits.',
    ].join('\n');
  },
};
