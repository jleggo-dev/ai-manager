/**
 * Table tests for `update_repertoire`'s status verbs — the deterministic router that turns a word
 * the coach wrote into a standing on a row.
 *
 * It is exactly the shape CLAUDE.md's rule names: pure, silent on failure, and behaviour-deciding.
 * Nothing throws when `learned` and `retired` are swapped — a finished piece just quietly lands in
 * the rotation with a celebration attached, or a real crossing goes uncounted. So: positives for
 * every verb, and near-misses for the words that look like verbs and are not.
 *
 * `parked` is the near-miss that matters. It WAS a standing until the four-standings design
 * (2026-09-02) dropped it, and a stale prompt or an older transcript will still offer it. It must
 * be rejected by name rather than silently aliased onto queued — the rejection is what teaches the
 * coach the vocabulary changed.
 */
import { describe, expect, it } from 'vitest';
import { STATUS_OF, UPDATE_REPERTOIRE } from './coach-action-repertoire.ts';

/** The declared enum, dug out of the JSON parameter schema the coach is handed. */
function declaredStatuses(): string[] {
  const items = UPDATE_REPERTOIRE.parameters.properties.items as {
    items: { properties: { status: { enum: string[] } } };
  };
  return items.items.properties.status.enum;
}

describe('STATUS_OF — the verb table', () => {
  const table: Array<[string, { status: string | undefined; markLearned: boolean }]> = [
    // An omitted status keeps an existing item exactly as it stands; a new row defaults to working
    // in the repo. A bare re-mention must never demote a known piece out of the rotation.
    ['', { status: undefined, markLearned: false }],
    ['queued', { status: 'queued', markLearned: false }],
    ['working', { status: 'working', markLearned: false }],
    ['known', { status: 'known', markLearned: false }],
    // `learned` is not its own standing: it is `known` plus the one-time stamp that writes the
    // accomplishment to the goal's history. Backfill (`known`) is quiet; only a crossing celebrates.
    ['learned', { status: 'known', markLearned: true }],
    // Retiring keeps whatever `learned_at` the row already had — "learned this year" never shrinks
    // because someone stopped revisiting a piece — so retire never stamps.
    ['retired', { status: 'retired', markLearned: false }],
  ];

  for (const [word, expected] of table) {
    it(`maps "${word || '(omitted)'}" to ${expected.status ?? 'no change'}${expected.markLearned ? ' + stamped learned' : ''}`, () => {
      expect(STATUS_OF.get(word)).toEqual(expected);
    });
  }

  it('never stamps learned on anything but the learned verb', () => {
    const stamping = [...STATUS_OF].filter(([, v]) => v.markLearned).map(([k]) => k);
    expect(stamping).toEqual(['learned']);
  });

  const nearMisses = ['parked', 'set aside', 'retire', 'queue', 'learn', 'Known', 'in progress', 'done', 'new'];
  for (const word of nearMisses) {
    it(`rejects "${word}" — it is not a standing, and no standing is aliased to it`, () => {
      expect(STATUS_OF.has(word)).toBe(false);
    });
  }
});

describe('the declared enum is the executable one', () => {
  /**
   * The enum is DERIVED from STATUS_OF rather than hand-copied, so "declared equals executable" is
   * true by construction — a hand-copied union always drifts eventually (FOOD_SOURCES went stale
   * in the web client and killed quick-add for weeks). What is worth asserting is therefore the
   * CONTENT: exactly these five words, in the order she reads them, and not one more.
   */
  it('offers exactly the five verbs, and parked is not among them', () => {
    expect(declaredStatuses()).toEqual(['queued', 'working', 'known', 'learned', 'retired']);
  });

  it('never offers the omitted case as a word she can write', () => {
    expect(declaredStatuses()).not.toContain('');
  });
});

describe('the tool description', () => {
  const description = UPDATE_REPERTOIRE.description;

  /** The action bound in retrieval/description-audit.test.ts. Asserted here too so the file that
   *  owns the string fails first, with the count in the message. */
  it(`stays inside the 800-character action bound (is ${description.length})`, () => {
    expect(description.length).toBeLessThanOrEqual(800);
  });

  it('teaches every verb it declares, so the coach never has to guess one', () => {
    for (const word of declaredStatuses()) expect(description).toContain(word);
  });

  it('still says the two things the audit requires of an action: when to use it, and its gate', () => {
    expect(description).toMatch(/\bUse\b/);
    expect(description).toMatch(/Takes effect immediately/);
  });

  it('says what an omitted status does — the default that keeps a re-mention harmless', () => {
    expect(description).toMatch(/\bomit it\b/i);
    expect(description).toMatch(/keep an item as it stands/i);
  });

  /**
   * The description field (owner ruling 2026-09-03) — the user's own words for which one it is,
   * and the field that replaced `catalogue`. It has to be TAUGHT here or she never sends it: the
   * Broker reads this string and never sees the JSON schema (TOOL-HARNESS.md §3), so a declared
   * parameter absent from the prose is a parameter that is never filled.
   */
  it('teaches the description field, with a quoted worked example', () => {
    expect(description).toContain('"description"');
    expect(description).toContain('"the fast one in G"');
    expect(description).toMatch(/a free-text description in their words/i);
  });

  it('declares exactly the fields it teaches — nothing silently undocumented', () => {
    const props = (UPDATE_REPERTOIRE.parameters.properties.items as { items: { properties: object } }).items.properties;
    expect(Object.keys(props).sort()).toEqual(['description', 'kind', 'label', 'status']);
    for (const key of Object.keys(props)) expect(description).toContain(`"${key}"`);
  });
});
