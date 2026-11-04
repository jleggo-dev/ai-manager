import { renderCheckFindings } from '@cadence/shared';
import { listUpcomingForRevision } from '../repos/occurrence-sessions.ts';
import { getUser } from '../repos/users.ts';
import { localDayIso, localDayIsoPlus } from './plan-day.ts';
import { matchActivity } from './plan-edit.ts';
import { REVISION_LOOKAHEAD_DAYS } from './coach-action-revise-session.ts';
import { rearrangeSession } from './rearrange-session.ts';
import { defineAction, type CoachActionTool } from './coach-action-types.ts';
import { toolActionFaultText, toolChangeText, toolNothingChangedText } from './tool-response.ts';

/**
 * `rearrange_session` — the coach changes the ORDER of one upcoming session in place from the
 * person's words (walkthrough v3 Phase 6, R2's agentic path): "alternate the presses and rows,
 * spread the dead hangs out". The same moves, the same numbers, a new structure, written at once
 * — never `revise_session`, which rebuilds the work itself. Reached through the `rebuild` facade's
 * `order` scope (coach-action-plan-facade.ts), in the drawer; its own file keeps the contract
 * and the tests beside the code.
 *
 * Addressing mirrors revise_session: a title as the plan lists it plus an optional date, one-or-
 * nothing `matchActivity`, floored at the person's own today. The answer is the structure diff
 * as facts, in the Recap's own fixed words, so what she says matches what the person's screen
 * says.
 */
export const REARRANGE_SESSION: CoachActionTool = defineAction({
  name: 'rearrange_session',
  mutates: 'immediate',
  description:
    'Change the ORDER of one upcoming session from their words, keeping every move and its numbers — "alternate the presses and rows", "spread the dead hangs through the session". {gate}: the session plays in the new structure when they open it. Use it when the work is right and only its arrangement is wrong; different work inside the session is revise_session. Pass {"session": "Strength", "steer": "alternate presses and rows, spread the hangs out", "date": "2026-11-04"} — "session" as the plan lists it, "steer" their words, and omitting "date" takes the soonest one coming up. Only a session still to do can be rearranged.',
  parameters: {
    properties: {
      session: { type: 'string', description: 'Which session, by the title the plan lists.' },
      steer: {
        type: 'string',
        description: 'How it should be arranged, in THEIR words — never your rewrite of what they asked.',
      },
      date: {
        type: 'string',
        description: 'The day it is scheduled, as YYYY-MM-DD. Omit to take the soonest upcoming one.',
      },
    },
    required: ['session', 'steer'],
  },
  async run(userId, params) {
    const query = String(params.session ?? '').trim();
    const steer = String(params.steer ?? '').trim();
    if (!query) return toolNothingChangedText('no session was named.', ['Ask which one they mean.']);
    if (!steer) return toolNothingChangedText('no arrangement was described.', ['Ask how they want it ordered.']);
    const date = String(params.date ?? '').trim();

    const timezone = (await getUser(userId).catch(() => null))?.timezone;
    const now = new Date();
    const rows = await listUpcomingForRevision(
      userId,
      localDayIso(now, timezone),
      localDayIsoPlus(now, REVISION_LOOKAHEAD_DAYS, timezone),
    );
    const scoped = date ? rows.filter((r) => r.date === date) : rows;
    const found = matchActivity(scoped, query);
    if (!found) {
      const upcoming = rows
        .slice(0, 5)
        .map((r) => `${r.date} ${r.title}`)
        .join('; ');
      return toolNothingChangedText(
        `no upcoming session clearly matches "${query}"${date ? ` on ${date}` : ''}. Coming up: ${upcoming || 'none'}.`,
        ['Ask which they mean.'],
      );
    }

    let result: Awaited<ReturnType<typeof rearrangeSession>>;
    try {
      result = await rearrangeSession(userId, found.occurrence_id, steer);
    } catch {
      return toolActionFaultText(`${found.title} on ${found.date} could not be rearranged`);
    }
    if (result.status === 'not_found') {
      return toolNothingChangedText(
        'that session vanished before it could be rearranged — their plan may have just changed.',
        ['Read get_active_plan and go again from what it lists.'],
      );
    }
    if (result.status === 'not_revisable') {
      if (result.reason === 'system_row')
        return toolNothingChangedText(
          'that row is a tracking entry the app manages — there is no session inside it to rearrange.',
        );
      if (result.reason === 'past')
        return toolNothingChangedText(
          `${found.title} on ${found.date} is in the past — a day that already happened is history, not a plan.`,
        );
      if (result.reason === 'no_session')
        return toolNothingChangedText(
          `${found.title} on ${found.date} has not been written yet — there is nothing to rearrange until it is opened once.`,
          ['get_session reads it once it exists.'],
        );
      return toolNothingChangedText(
        `${found.title} on ${found.date} is already recorded, so its session is history now and was left alone.`,
      );
    }
    if (result.status === 'items_changed') {
      return toolActionFaultText(
        `${found.title} on ${found.date} was not rearranged: the new arrangement did not hold the same moves, so it was refused and nothing was written`,
        'tell the user plainly and offer to try again with the same words.',
      );
    }
    if (result.status === 'failed') {
      return toolActionFaultText(
        `${found.title} on ${found.date} could not be rearranged (${result.error})`,
        'tell the user plainly and offer to try again.',
      );
    }

    const facts = result.changes.map((c) => c.words);
    const findings = result.findings.length
      ? [`The session's own check found: ${renderCheckFindings(result.findings).replace(/\n/g, ' ')}`]
      : [];
    return toolChangeText({
      changed: [
        `Rearranged: ${found.title} on ${found.date}${facts.length ? ` — ${facts.join('; ')}` : ' — a new order, the same moves'}.`,
      ],
      unchanged: ['Every move and its numbers are as they were.', ...findings],
      next: ['It is already on their plan — nothing to tap. Say what changed in those words.'],
    });
  },
});
