import type { MealPreview } from '../../lib/api.ts';
import { FOUND_CARD, NOT_REACHED_CARD } from './coachReadCopy.ts';

/**
 * The line above a confirm card that says who read the meal, with her trace under it — one
 * component for the chat door and the photo door, so a photographed meal reads exactly as a typed
 * one does (FOOD-LOGGING-COACH-LED.md, build step 4). A table of three, each pinned by the doors'
 * tests because every branch is one wrong `?.` away from the other: she could not be reached → the
 * notice with the card's tap hint; she read it → the normal line; no coach block at all (an older
 * server) → the normal line. The trace renders only from what actually ran: present → "Checked …",
 * empty → nothing, never canned copy. Lines of what they gave that were NOT looked up (the photo
 * door's `not_read`: a sentence after the list, a heading, lines past the caps) are said here too,
 * in their words, so nothing is dropped quietly.
 */
/** One sentence from a list of lines: a line that already ends like a sentence does not get a second full stop. */
const sentence = (lines: string[]): string => {
  const joined = lines.join('; ');
  return /[.!?]$/.test(joined) ? joined : `${joined}.`;
};

export function CoachReadLine({
  coach,
  notRead,
  className = 'fc-heard',
}: {
  coach: MealPreview['coach'];
  notRead?: MealPreview['not_read'];
  /** The chat bubble by default; a host with its own note style passes its class. */
  className?: string;
}) {
  return (
    <div className={className}>
      {coach?.reached === false ? NOT_REACHED_CARD : FOUND_CARD}
      {coach?.checked?.length ? <small> Checked {sentence(coach.checked)}</small> : null}
      {notRead?.length ? <small> Not read: {sentence(notRead)}</small> : null}
    </div>
  );
}
