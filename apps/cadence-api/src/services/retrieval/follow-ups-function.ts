import { FOLLOW_UP_ID_PREFIX, listOpenFollowUps, type FollowUp } from '../../repos/follow-ups.ts';
import type { RetrievalFunction } from './types.ts';

/**
 * The things she said she would come back to, in front of her on every turn.
 *
 * Dossier, not a tool (TOOL-HARNESS checklist step 1): she needs these without asking, the way she
 * needs their goals, so the read sits in the pack's MANDATORY list and the per-turn floor and
 * `find_tools` answers a search for it with "already have". The write half is the pair of actions
 * in coach-action-follow-ups.ts.
 *
 * Facts, not picks: the section lists what is open, with its date and age. It never says which to
 * raise, or when — that is hers. An item is shown with its age once it has been open past
 * AGE_SHOWN_AFTER_DAYS, so a thing she keeps not getting to reads as old rather than as new.
 */

/** Past this many days open, the line says how long. */
export const AGE_SHOWN_AFTER_DAYS = 30;
export const FOLLOW_UPS_HEADING = "== THINGS YOU SAID YOU'D COME BACK TO ==";

/** One line per follow-up: the id she closes it by, her words, the date if any, the age if old. */
export function renderFollowUps(items: FollowUp[]): string {
  if (!items.length) return '';
  const lines = items.map((f) => {
    const tags = [
      f.due_on ? `due ${f.due_on}` : null,
      f.age_days > AGE_SHOWN_AFTER_DAYS ? `open ${f.age_days} days` : null,
    ]
      .filter(Boolean)
      .join(', ');
    return `- [${f.follow_up_id.slice(0, FOLLOW_UP_ID_PREFIX)}] ${f.text}${tags ? ` (${tags})` : ''}`;
  });
  return [
    FOLLOW_UPS_HEADING,
    ...lines,
    'Close one with close_follow_up and its id in brackets once it is dealt with.',
  ].join('\n');
}

export const GET_FOLLOW_UPS: RetrievalFunction = {
  name: 'get_follow_ups',
  description:
    'The things you told the user you would come back to, or they asked you to remember — noted with note_follow_up, still open. Newest first, with the date you gave and how long each has been open. In your context every turn; nothing to fetch.',
  domains: ['follow_ups'],
  async run(userId) {
    return listOpenFollowUps(userId);
  },
  render(r) {
    return renderFollowUps(r as FollowUp[]);
  },
  rows(r) {
    return (r as unknown[]).length;
  },
};
