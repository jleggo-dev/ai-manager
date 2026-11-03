import type { MealPreview } from '../../lib/api.ts';
import { ANOTHER_GO_CARD, FOUND_CARD, NOT_REACHED_CARD } from './coachReadCopy.ts';
import { CoachTrace } from './CoachTrace.tsx';

/**
 * The line above a confirm card that says who read the meal, with her trace under it — one
 * component for the chat door and the photo door, so a photographed meal reads exactly as a typed
 * one does (FOOD-LOGGING-COACH-LED.md, build step 4). A table of three, each pinned by the doors'
 * tests because every branch is one wrong `?.` away from the other: she could not be reached → the
 * notice with the card's tap hint; she read it → the normal line; no coach block at all (an older
 * server) → the normal line. The trace (CoachTrace) renders only from what actually ran: present →
 * one line with the parts behind a tap, empty → nothing, never canned copy. What was NOT looked
 * up (`coach.not_read`: a part past the split's cap or said twice, a part that was not a food; on
 * the photo door a sentence after the list, a heading, lines past the caps) is said in the open,
 * in their words, so nothing is dropped quietly.
 */
export function CoachReadLine({
  coach,
  corrected = false,
  className = 'fc-heard',
}: {
  coach: MealPreview['coach'];
  /** This card is the re-read after "not quite": the line says so. */
  corrected?: boolean;
  /** The chat bubble by default; a host with its own note style passes its class. */
  className?: string;
}) {
  return (
    <div className={className}>
      {coach?.reached === false ? NOT_REACHED_CARD : corrected ? ANOTHER_GO_CARD : FOUND_CARD}
      {/* Her work, drawn like a tool call: one line, the parts behind a tap; what was not read, in the open. */}
      <CoachTrace coach={coach} />
    </div>
  );
}
