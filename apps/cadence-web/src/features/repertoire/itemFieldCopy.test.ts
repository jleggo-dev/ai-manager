/**
 * The item screen's field hints, held to the rule they exist to obey (owner ruling 2026-09-03):
 * **a hint says what the field is FOR, in clear unambiguous words, and never narrows it to one
 * domain by listing examples.**
 *
 * The hints these replaced did exactly that — "bars 9-16, p. 240, first stanza, for 5th kyu" under
 * the note field, "Suzuki Piano Book 2, ABRSM Grade 3…" under the collection one. Owner: *"'bars
 * 9-16' means absolutely nothing to a karateka trying to enter heian shodan in the app. This is a
 * multi-purpose list screen. Stop narrowing the focus."*
 *
 * It is a silent failure, which is why it is a table and not a memo: a domain example reads as
 * helpful, renders perfectly, and quietly tells a whole category of user that this screen is not
 * for them. So the words are pinned verbatim, and the banned shapes are pinned as near-misses.
 */
import { describe, expect, it } from 'vitest';
import { ADD_A_COLLECTION, COLLECTION_LOOKUP_PLACEHOLDER, FIELD_HINTS, NO_COLLECTION } from './itemFieldCopy.ts';

describe('the field hints', () => {
  it('read exactly as the owner wrote them', () => {
    expect(FIELD_HINTS.composer).toBe('Who wrote, composed, or created it');
    expect(FIELD_HINTS.collection).toBe('Select or add a collection to group this with (ex. book, list, syllabus)');
    expect(FIELD_HINTS.description).toBe("Write a clear description Cadence will use to understand what you're doing");
    expect(FIELD_HINTS.note).toBe('Any notes for yourself or Cadence to refer to');
  });

  /**
   * The near-miss table. Every word below appeared in a hint on this screen before today, and each
   * one names ONE domain's material — music's bars and pieces, a book's page, a poem's stanza, a
   * karate grade, and the two collections that were used as the examples.
   */
  const DOMAIN_WORDS = [
    /bars? \d/i,
    /\bp\. ?\d/i,
    /stanza/i,
    /\bkyu\b/i,
    /\bkata\b/i,
    /\bpiece/i,
    /\bcomposer\b/i,
    /\bcatalogue\b/i,
    /Suzuki/i,
    /ABRSM/i,
    /\bbelt\b/i,
    /\bverse\b/i,
  ];

  it.each(Object.entries(FIELD_HINTS))('%s names no single domain', (_field, hint) => {
    for (const re of DOMAIN_WORDS) expect(hint, `"${hint}" narrows the field to one domain`).not.toMatch(re);
  });

  it('says what the field is FOR — every hint is a purpose, not a list of examples', () => {
    for (const hint of Object.values(FIELD_HINTS)) {
      expect(hint.length).toBeGreaterThan(20);
      // A trailing ellipsis is the shape an example list takes ("a, b, c…").
      expect(hint).not.toMatch(/…$/);
    }
  });

  /** "ex. book, list, syllabus" is a category gloss, not a domain example: it says what KIND of
   *  thing a collection is, in three domains at once rather than one. That is the distinction the
   *  ruling draws, so the two strings that carry it are pinned rather than caught by the table. */
  it('the collection strings name three kinds together, never one', () => {
    for (const s of [FIELD_HINTS.collection, COLLECTION_LOOKUP_PLACEHOLDER]) {
      expect(s).toContain('book');
      expect(s).toContain('list');
      expect(s).toContain('syllabus');
    }
  });

  it('the lookup placeholder says what typing a name DOES — it is a different control', () => {
    expect(COLLECTION_LOOKUP_PLACEHOLDER).toBe(
      "Type the name of a collection to look up what's in it (ex. book, list, syllabus)",
    );
  });
});

describe('the collection select options', () => {
  it('reads as the two synthetic ends of the list', () => {
    expect(NO_COLLECTION).toBe('None');
    expect(ADD_A_COLLECTION).toBe('Add a collection…');
  });

  it('cannot collide with a real collection name a person would type', () => {
    expect(NO_COLLECTION).not.toBe(ADD_A_COLLECTION);
  });
});
