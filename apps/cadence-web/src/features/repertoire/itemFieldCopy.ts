/**
 * The words under the item screen's fields, and the two options its Collection select adds to the
 * names already on the shelf.
 *
 * Own file, and pinned by a test, because of the rule these strings exist to obey (owner ruling
 * 2026-09-03): **a hint says what the field is FOR, in clear unambiguous words, and never narrows
 * it to one domain by listing examples.** The hints these replaced did exactly that —
 * *"'bars 9-16' means absolutely nothing to a karateka trying to enter heian shodan in the app.
 * This is a multi-purpose list screen. Stop narrowing the focus."*
 *
 * It is a silent failure: "bars 9-16, p. 240, first stanza" reads as helpful and quietly tells a
 * whole category of user that this screen is not for them. So the rule is asserted rather than
 * remembered — itemFieldCopy.test.ts fails on a domain example appearing in any of these.
 */
export const FIELD_HINTS = {
  composer: 'Who wrote, composed, or created it',
  collection: 'Select or add a collection to group this with (ex. book, list, syllabus)',
  description: "Write a clear description Cadence will use to understand what you're doing",
  note: 'Any notes for yourself or Cadence to refer to',
} as const;

/** The Collection select's synthetic options, either side of the real collections. Values as well
 *  as labels, so the control has no separate sentinel to keep in step with what it renders — and
 *  neither is a uuid, so neither can ever collide with a real collection's id. The third,
 *  `MANAGE_COLLECTIONS`, lives in collectionsCopy.ts beside the screen it opens. */
export const NO_COLLECTION = 'None';
export const ADD_A_COLLECTION = 'Add a collection…';

/**
 * The seed field is a DIFFERENT control from the item screen's Collection select and stays free
 * text: there, typing a name is how you ask Cadence to look up what is in it, so there is nothing
 * to choose from yet. Held here beside the select's own copy so the difference is visible in one
 * place rather than inferred from two screens.
 */
export const COLLECTION_LOOKUP_PLACEHOLDER =
  "Type the name of a collection to look up what's in it (ex. book, list, syllabus)";
