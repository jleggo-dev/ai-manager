/**
 * Table tests for the repertoire matcher — the deterministic router that decides "did they mean
 * THIS piece". It had none: it is pure, it fails silently, and its two failure modes are not
 * symmetric (the module's own rule) — a miss leaves one stale date and self-corrects on the next
 * log, a false hit shoves a piece to the back of the rotation where nothing ever fixes it.
 *
 * So this is positives AND near-misses, per CLAUDE.md's rule for routers that decide behaviour.
 * The near-misses are the point: "Rain" must not match "training" is the exact case the matcher's
 * word-boundary rule exists for, and nothing was holding it.
 */
import { describe, expect, it } from 'vitest';
import { findItemForTitle, itemNamedIn, matchHay, matchableItems } from './repertoire-practice.ts';

const item = (label: string, over: { status?: string; goal_id?: string | null } = {}) => ({
  label,
  status: over.status ?? 'known',
  goal_id: over.goal_id ?? null,
});

const PIANO = 'goal-piano';
const RUN = 'goal-run';

describe('itemNamedIn', () => {
  const hit = (label: string, text: string) => itemNamedIn(label, matchHay([text]));

  it('matches the label as written', () => {
    expect(hit('Minuet in G', 'Played Minuet in G today')).toBe(true);
  });

  it('matches the label CORE when the stored label carries qualifiers', () => {
    expect(hit('A Short Story (Lichner)', 'worked on a short story')).toBe(true);
    expect(hit('Écossaise by J.N. Hummel', 'ran through the Écossaise twice')).toBe(true);
    expect(hit('Minuet in G Major, BWV 822', 'minuet in g major felt good')).toBe(true);
  });

  it('needs a WHOLE word — the case the boundary rule exists for', () => {
    expect(hit('Rain', 'a long training session')).toBe(false);
    expect(hit('Rain', 'played Rain slowly')).toBe(true);
  });

  it('ignores labels too short to be evidence', () => {
    expect(hit('Bo', 'the bo staff kata and a bo drill')).toBe(false);
  });

  it('is unaffected by case, punctuation, and NFC/NFD form', () => {
    expect(hit('Écossaise', 'Écossaise, twice')).toBe(true);
    // The iOS text path emits NFD ("E" + combining accent). Both sides are NFC-normalized first,
    // which is the whole reason labels are stored NFC.
    expect(hit('Écossaise', 'Écossaise, twice'.normalize('NFD'))).toBe(true);
    expect(hit('Écossaise'.normalize('NFD'), 'Écossaise, twice')).toBe(true);
  });

  // Documented, not endorsed. `normTitle` maps every non-[a-z0-9] run to a SPACE, so "Écossaise"
  // reduces to "cossaise" and an unaccented "Ecossaise" reduces to "ecossaise" — no word-boundary
  // match between them. It is invisible to the tempo path (a step title and its item label both
  // come from the coach, so both carry the accent), but a person typing "Ecossaise" into a free
  // text log will not stamp the piece. Folding accents to their base letter belongs in normTitle,
  // which goal identity also depends on — a deliberate change, not a drive-by one.
  it('does NOT currently match an unaccented spelling of an accented label', () => {
    expect(hit('Écossaise', 'played ecossaise twice')).toBe(false);
  });

  it('does not match on an empty haystack', () => {
    expect(itemNamedIn('Minuet', matchHay([]))).toBe(false);
    expect(itemNamedIn('Minuet', matchHay(['', null, undefined]))).toBe(false);
  });
});

describe('matchableItems', () => {
  const items = [
    item('Piano piece', { goal_id: PIANO }),
    item('Run drill', { goal_id: RUN }),
    item('Unlinked', { goal_id: null }),
    item('Set aside', { goal_id: PIANO, status: 'parked' }),
  ];

  it("keeps this goal's items and unlinked ones, drops another goal's", () => {
    expect(matchableItems(items, PIANO).map((i) => i.label)).toEqual(['Piano piece', 'Unlinked']);
  });

  it('never returns a parked item — it is out of the rotation by definition', () => {
    expect(matchableItems(items, PIANO).some((i) => i.status === 'parked')).toBe(false);
  });

  it('an unscoped session still cannot reach another goal’s items', () => {
    expect(matchableItems(items, null).map((i) => i.label)).toEqual(['Unlinked']);
  });
});

describe('findItemForTitle', () => {
  it('finds the piece a step title names', () => {
    const items = [item('Écossaise (Hummel)', { goal_id: PIANO }), item('Minuet in G', { goal_id: PIANO })];
    expect(findItemForTitle(items, 'Écossaise', PIANO)?.label).toBe('Écossaise (Hummel)');
  });

  it('prefers the LONGEST label when several match — not row order', () => {
    const items = [item('Study', { goal_id: PIANO }), item('Study in C major', { goal_id: PIANO })];
    expect(findItemForTitle(items, 'Study in C major', PIANO)?.label).toBe('Study in C major');
    // Same table, reversed: the answer must not depend on the order rows came back in.
    expect(findItemForTitle([...items].reverse(), 'Study in C major', PIANO)?.label).toBe('Study in C major');
  });

  it("will not reach across goals — a run step cannot name the piano's piece", () => {
    const items = [item('Melody', { goal_id: PIANO })];
    expect(findItemForTitle(items, 'had a Melody stuck in my head', RUN)).toBeNull();
  });

  it('is null when nothing matches, rather than guessing', () => {
    const items = [item('Écossaise (Hummel)', { goal_id: PIANO })];
    expect(findItemForTitle(items, 'Scales and arpeggios', PIANO)).toBeNull();
    expect(findItemForTitle([], 'Écossaise', PIANO)).toBeNull();
    expect(findItemForTitle(items, '', PIANO)).toBeNull();
  });
});
