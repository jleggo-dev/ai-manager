/**
 * "Your collections" (P11, migration 0056) — every word a person reads on the screen, pinned
 * verbatim. `collectionsCopy.ts`'s own header says these strings are "pinned by a test" (the same
 * claim `itemFieldCopy.ts` makes for its own strings, and the reason that file has
 * `itemFieldCopy.test.ts`); this is that test.
 *
 * Two things matter enough to fail loudly rather than be caught by eye:
 *
 *  - **The remove confirmation names the consequence, not just the fact of removal.** "Remove this
 *    collection?" alone would leave a person to find out by trying it that the items in it survive
 *    (the foreign key is `on delete set null`) — the whole reason CollectionRow.tsx shows this
 *    sentence BEFORE the delete, never after.
 *  - **The plural rule.** `itemCountLine` is a tiny router — "0 items" vs "1 item" vs "3 items" —
 *    and a router like that fails silently: get the boundary wrong and a row reads "1 items" or "2
 *    item" forever, and nothing throws. CLAUDE.md's rule ("every button gets a table test") applies
 *    to any deterministic router, not just the ones behind a tap.
 */
import { describe, expect, it } from 'vitest';
import {
  COLLECTIONS_EMPTY,
  COLLECTIONS_TITLE,
  COLLECTION_NAME_HINT,
  COLLECTION_NAME_LABEL,
  MANAGE_COLLECTIONS,
  REMOVE_COLLECTION_CONFIRM,
  itemCountLine,
} from './collectionsCopy.ts';

describe('the collections screen copy — read exactly as the owner wrote it', () => {
  it('the title', () => {
    expect(COLLECTIONS_TITLE).toBe('Your collections');
  });

  it('the empty line — says where a collection comes FROM, since there is no "add" button here', () => {
    expect(COLLECTIONS_EMPTY).toBe('No collections yet. Add one from any item, or look one up from the list.');
  });

  it('the add form (reached from the item picker, not from this screen)', () => {
    expect(COLLECTION_NAME_LABEL).toBe('Collection name');
    expect(COLLECTION_NAME_HINT).toBe("A name you'll recognise later");
  });

  /** Said BEFORE anything is removed. The sentence's whole job is to name the consequence at the
   *  point of choice, so the exact wording — "stay on your list" / "won't be grouped" — is the
   *  test, not just that some confirmation string exists. */
  it('the remove confirmation, naming the consequence before the tap', () => {
    expect(REMOVE_COLLECTION_CONFIRM).toBe(
      "Remove this collection? The items in it stay on your list; they just won't be grouped.",
    );
  });

  it("the picker's door back to this screen", () => {
    expect(MANAGE_COLLECTIONS).toBe('Manage collections…');
  });
});

describe('itemCountLine — the plural rule', () => {
  it.each([
    [0, '0 items'],
    [1, '1 item'],
    [2, '2 items'],
    [3, '3 items'],
    [27, '27 items'],
  ])('renders %i as %j', (count, expected) => {
    expect(itemCountLine(count)).toBe(expected);
  });

  /** The near-miss this table exists to catch: a boundary off by one reads "1 items" or "2 item"
   *  forever on exactly the counts that matter most (a fresh collection, and the first item added
   *  to it), and nothing throws either way. */
  it('singular is exactly the count of 1, never any other count', () => {
    for (const n of [0, 2, 3, 10]) expect(itemCountLine(n)).not.toMatch(/^1? ?item$/);
    expect(itemCountLine(1)).not.toContain('items');
  });
});
