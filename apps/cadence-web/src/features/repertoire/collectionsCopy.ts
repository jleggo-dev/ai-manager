/**
 * Every word a person reads on the collections screen, and the two the item screen's picker adds.
 *
 * Own file, and pinned by a test, for the reason `itemFieldCopy.ts` is: these strings are the
 * owner's, verbatim, and each one is doing a specific job that a reworded version would quietly
 * stop doing.
 *
 *  - The remove confirmation names the CONSEQUENCE at the point of choice. Removing a collection
 *    leaves every item in it exactly where it was (the foreign key is `on delete set null`), and
 *    nobody will risk finding that out by trying it — so the sentence says it before the tap.
 *  - The empty line says where a collection comes FROM. There is no "make one" button on an empty
 *    screen by design: a collection is something you file material into, so you make one from the
 *    item you are filing, or when you look a book up.
 *  - Nothing here names a domain. A collection is a book, a syllabus, a reading list, a set of
 *    poems, a grading ladder; the one place examples appear is the picker's hint, which the owner
 *    wrote (`FIELD_HINTS.collection` in itemFieldCopy.ts).
 */
export const COLLECTIONS_TITLE = 'Your collections';

export const COLLECTIONS_EMPTY = 'No collections yet. Add one from any item, or look one up from the list.';

/** The add form's own two lines. The hint says what the name is FOR — a thing they will recognise
 *  later — rather than listing what a collection can be, which is the picker's job. */
export const COLLECTION_NAME_LABEL = 'Collection name';
export const COLLECTION_NAME_HINT = "A name you'll recognise later";

/** Said before anything is removed, never after. */
export const REMOVE_COLLECTION_CONFIRM =
  "Remove this collection? The items in it stay on your list; they just won't be grouped.";

/** The picker's third synthetic option, under "Add a collection…": the way to this screen from the
 *  item you are filing. Choosing it never becomes the item's collection — it opens the screen. */
export const MANAGE_COLLECTIONS = 'Manage collections…';

/** "3 items" — how many things point at a collection right now. Zero is a legitimate answer since
 *  a collection became a row of its own: it exists because they made it, not because something is
 *  in it. Plural rule spelled once, so the row and any future caller cannot disagree. */
export function itemCountLine(count: number): string {
  return `${count} item${count === 1 ? '' : 's'}`;
}
