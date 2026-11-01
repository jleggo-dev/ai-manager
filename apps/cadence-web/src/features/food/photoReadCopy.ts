/**
 * The photo door's own words (PhotoReadPanel, useMealPhotoRead) — plain and kind, in the house
 * voice, never a raw API string on screen (review of #457: "meal preview failed: 400" was). UI
 * copy names the role, "the coach", never the product (owner, 2026-09-06).
 */

/** Over the reading box once the eyes have answered. The list rule is said because each line is looked up on its own. */
export const HERE_IS =
  'Here’s what I can see — fix anything I got wrong. Each line of the list at the end is looked up on its own.';

/** The eyes could not read the photo (a failed stage 1): the box is empty and open, the caption still counts. */
export const READ_FAILED = 'The coach couldn’t read the photo. Type what it was below, or try again.';

/** The read ran and found no line that reads as a food (a 400, or an empty card). */
export const NO_FOODS = 'I couldn’t pick any foods out of that — one food or drink a line, the amount first.';

/** A call ran past its bound. */
export const TOO_LONG = 'That took too long — try again in a moment.';

/** Any other fault working the meal out — the chat door's wording. */
export const WORK_OUT_FAILED = 'Couldn’t work that out just now — try again in a moment.';
