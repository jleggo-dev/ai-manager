import { closeFollowUp, noteFollowUp, FOLLOW_UP_ID_PREFIX } from '../repos/follow-ups.ts';
import type { CoachActionTool } from './coach-action-types.ts';

/**
 * `note_follow_up` and `close_follow_up` — the write half of follow-ups (HARNESS-V3 C3).
 *
 * The coach writes her own follow-ups. Not the Broker, not capture: the person who promised to
 * check on the knee is her, and a promise inferred from her prose by a second model is one she
 * never made. So these are tools she calls, and the list they feed (retrieval/follow-ups-function.ts)
 * is in front of her on every turn until she closes an item. Drawer tier — most days she notes
 * nothing — with a hook in DRAWER_HOOKS so she can find them.
 *
 * Both read their own write back, the way set_home_location does: a return text that says "noted"
 * when the row did not land would be a lie in her voice.
 */

const MAX_TEXT = 300;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const NOTE_FOLLOW_UP: CoachActionTool = {
  name: 'note_follow_up',
  description:
    'Write down one thing you will come back to with them later, so it is in front of you in every later conversation until you close it. Takes effect immediately. Use when you tell them you will check on something — "ask me again after the 18K", "I\'ll see how the knee is next week" — or they ask you to remember to raise something; do not use it for goals, plan changes or facts about them, which have their own tools. Pass {"text": "ask how the race entry went", "due_on": "2026-11-07"} — "text" in plain words as you would say it back, "due_on" a YYYY-MM-DD date if one was named; omit "due_on" when no date was given.',
  parameters: {
    properties: {
      text: {
        type: 'string',
        description:
          'What you will come back to, as you would say it to them, e.g. "ask how the race entry went". Required.',
      },
      due_on: {
        type: 'string',
        description: 'When, as YYYY-MM-DD, e.g. "2026-11-07". Omit it when they named no date.',
      },
    },
    required: ['text'],
  },
  async run(userId, params) {
    const text = String(params.text ?? '').trim();
    if (!text) return 'No text was given, so nothing was noted.';
    if (text.length > MAX_TEXT)
      return `That is ${text.length} characters; keep it under ${MAX_TEXT}. Nothing was noted.`;
    const dueRaw = params.due_on == null ? '' : String(params.due_on).trim();
    if (dueRaw && !ISO_DATE.test(dueRaw)) return `"due_on" must be YYYY-MM-DD (got "${dueRaw}"). Nothing was noted.`;

    const row = await noteFollowUp(userId, { text, due_on: dueRaw || null });
    const id = row.follow_up_id.slice(0, FOLLOW_UP_ID_PREFIX);
    return `Noted [${id}]: ${row.text}${row.due_on ? ` (due ${row.due_on})` : ''}. It stays in your context every turn until you close it with close_follow_up.`;
  },
};

export const CLOSE_FOLLOW_UP: CoachActionTool = {
  name: 'close_follow_up',
  description:
    'Close one follow-up you noted earlier, once it is dealt with or no longer applies. Takes effect immediately. Use when you have come back to it with them, or they say to drop it; do not use it to edit the wording — close it and note a new one. Pass {"id": "3f9a2c1d", "outcome": "entry confirmed, race is on"} — "id" is the bracketed code shown beside the item in your context, "outcome" a few words on how it ended; omit "outcome" if there is nothing to say.',
  parameters: {
    properties: {
      id: {
        type: 'string',
        description: 'The bracketed code beside the item in your context, e.g. "3f9a2c1d". Required.',
      },
      outcome: {
        type: 'string',
        description: 'How it ended, in a few words, e.g. "entry confirmed". Omit it if there is nothing to say.',
      },
    },
    required: ['id'],
  },
  async run(userId, params) {
    const id = String(params.id ?? '').trim();
    if (!id) return 'No id was given, so nothing was closed.';
    const outcome = params.outcome == null ? null : String(params.outcome).trim() || null;

    const row = await closeFollowUp(userId, id, 'coach', outcome);
    if (!row)
      return `No open follow-up matches "${id}" — check the bracketed code in your context. Nothing was closed.`;
    return `Closed [${row.follow_up_id.slice(0, FOLLOW_UP_ID_PREFIX)}]: ${row.text}${outcome ? ` — ${outcome}` : ''}. It will not appear in your context again.`;
  },
};
