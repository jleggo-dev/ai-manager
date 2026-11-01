import { FOLLOW_UP_ID_PREFIX, getFollowUpList, type FollowUp, type FollowUpList } from '../../repos/follow-ups.ts';
import type { RetrievalFunction } from './types.ts';

/**
 * The things she said she would come back to, in front of her on every turn.
 *
 * Dossier, not a tool (TOOL-HARNESS checklist step 1): she needs these without asking, the way she
 * needs their goals, so the read sits in the per-turn floor and `find_tools` answers a search for it
 * with "already have". The write half is the pair of actions in coach-action-follow-ups.ts.
 *
 * The floor ONLY, not the session-open pack too (P7b): the pack is built once and pinned for the
 * session's life, so a list she closed mid-session stayed there as if open. The floor re-reads
 * every turn, and once anything has ever been noted it says "none open" out loud rather than
 * going quiet — a silent floor left the last list she saw standing as the current one.
 *
 * Facts, not picks: the section lists what is open, with its date and age. It never says which to
 * raise, or when — that is hers. An item is shown with its age once it has been open past
 * AGE_SHOWN_AFTER_DAYS, so a thing she keeps not getting to reads as old rather than as new.
 */

/** Past this many days open, the line says how long. */
export const AGE_SHOWN_AFTER_DAYS = 30;
export const FOLLOW_UPS_HEADING = "== THINGS YOU SAID YOU'D COME BACK TO ==";
/** Said when nothing is open but something once was — so an older list in the conversation is not read as current. */
export const NONE_OPEN_LINE = '- none open right now';
/**
 * The weekly fact review's questions sit on this list too (C7), and she never said them. The tag
 * says where the line came from, so it does not read as her promise.
 */
export const FACT_REVIEW_TAG = 'a question from checking their file';
const CLOSE_HINT = 'Close one with close_follow_up and its id in brackets once it is dealt with.';

/** One line per follow-up: the id she closes it by, the words, the date if any, the age if old, where it came from. */
function renderLine(f: FollowUp): string {
  const tags = [
    f.due_on ? `due ${f.due_on}` : null,
    f.age_days > AGE_SHOWN_AFTER_DAYS ? `open ${f.age_days} days` : null,
    f.source === 'fact-review' ? FACT_REVIEW_TAG : null,
  ]
    .filter(Boolean)
    .join(', ');
  return `- [${f.follow_up_id.slice(0, FOLLOW_UP_ID_PREFIX)}] ${f.text}${tags ? ` (${tags})` : ''}`;
}

/**
 * The count of what the cap left off, and which ones they are — stated from the list order, never
 * chosen: dated ones come first (soonest due), then undated (newest). If the last one shown has no
 * date, everything hidden is older and undated; if it has one, the hidden ones are due later or undated.
 */
function hiddenLine(items: FollowUp[], open: number): string | null {
  const hidden = open - items.length;
  if (hidden <= 0) return null;
  const lastDated = Boolean(items[items.length - 1]?.due_on);
  const which = lastDated
    ? hidden === 1
      ? 'one due later, or with no date'
      : 'ones due later, or with no date'
    : hidden === 1
      ? 'an older one with no date'
      : 'older ones with no date';
  return `And ${hidden} more open, not shown here: ${which}.`;
}

export function renderFollowUps({ items, open, everHad }: FollowUpList): string {
  if (!items.length) return everHad ? [FOLLOW_UPS_HEADING, NONE_OPEN_LINE].join('\n') : '';
  const hidden = hiddenLine(items, open);
  return [FOLLOW_UPS_HEADING, ...items.map(renderLine), ...(hidden ? [hidden] : []), CLOSE_HINT].join('\n');
}

export const GET_FOLLOW_UPS: RetrievalFunction = {
  name: 'get_follow_ups',
  mutates: 'none',
  description:
    'The things you told the user you would come back to, or they asked you to remember — noted with note_follow_up, still open. Soonest due first, then newest, with the date you gave and how long each has been open. In your context every turn; nothing to fetch.',
  domains: ['follow_ups'],
  async run(userId) {
    return getFollowUpList(userId);
  },
  render(r) {
    return renderFollowUps(r as FollowUpList);
  },
  rows(r) {
    return (r as FollowUpList).items.length;
  },
};
