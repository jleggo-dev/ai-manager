/**
 * Titles that name more than one piece.
 *
 * Classical repertoire collides BY DESIGN, and Suzuki Book 2 is the proof: it contains "Minuet in
 * G Major, BWV 822", "Minuet in G Major (from Notebook for Anna Magdalena Bach)" and "Minuet in G
 * Minor, BWV 822" — three different pieces, and two of them differ only in the qualifier the
 * matcher's core needle strips. So the shelf below is the real Book 2 list, used as the fixture:
 * the failure this file guards only shows up on a shelf that actually collides.
 *
 * Before this, a log saying "Minuet in G Major" stamped TWO pieces, and a step titled that wrote
 * its tempo onto whichever label happened to be longest.
 */
import { describe, expect, it } from 'vitest';
import {
  ambiguousNeedles,
  collidingTitles,
  findItemForTitle,
  isResolvable,
  itemNamedIn,
  matchHay,
  renderRepertoireForCoach,
} from './repertoire-practice.ts';
import type { RepertoireItem } from '@cadence/shared';

const PIANO = 'goal-piano';

/** Suzuki Piano Book 2, as a shelf. */
const BOOK2 = [
  'Écossaise (Hummel)',
  'A Short Story (Lichner)',
  'The Happy Farmer (from Album for the Young, Op. 68, No. 10)',
  'Minuet in G Major, BWV 822',
  'Minuet in G Major (from Notebook for Anna Magdalena Bach)',
  'Minuet in G Minor, BWV 822',
  'Cradle Song, Op. 13, No. 2',
  'Arietta',
  'Hungarian Folk Song (from For Children, Sz. 42)',
  'Melody (from Album for the Young, Op. 68, No. 1)',
  'Sonatina in G Major, Anh. 5 (Moderato, Romance)',
  'Children at Play (from For Children, Sz. 42)',
];

const shelf = BOOK2.map((label) => ({ label, status: 'known', goal_id: PIANO }));

const found = (mention: string) => findItemForTitle(shelf, mention, PIANO)?.label ?? null;

describe('a title shared by two pieces decides nothing', () => {
  it('refuses to guess which minuet a bare "Minuet in G Major" means', () => {
    expect(found('Minuet in G Major')).toBeNull();
  });

  it('still resolves each minuet from its FULL title', () => {
    expect(found('Minuet in G Major, BWV 822')).toBe('Minuet in G Major, BWV 822');
    expect(found('Minuet in G Major (from Notebook for Anna Magdalena Bach)')).toBe(
      'Minuet in G Major (from Notebook for Anna Magdalena Bach)',
    );
  });

  it('keeps Major and Minor apart — the qualifier that survives the core strip', () => {
    expect(found('Minuet in G Minor, BWV 822')).toBe('Minuet in G Minor, BWV 822');
  });

  it('does not block titles that are unique on this shelf', () => {
    expect(found('A Short Story')).toBe('A Short Story (Lichner)');
    expect(found('Melody')).toBe('Melody (from Album for the Young, Op. 68, No. 1)');
    expect(found('Arietta')).toBe('Arietta');
    expect(found('Écossaise')).toBe('Écossaise (Hummel)');
    expect(found('ecossaise')).toBe('Écossaise (Hummel)'); // accent folding still applies
  });

  it('blocks only the shared needle, not every needle the colliding items have', () => {
    const blocked = ambiguousNeedles(shelf);
    expect(blocked.has('minuet in g major')).toBe(true);
    expect(blocked.has('minuet in g major bwv 822')).toBe(false);
    expect(blocked.has('minuet in g minor bwv 822')).toBe(false);
    expect(blocked.has('a short story')).toBe(false);
  });

  it('stops a free-text log from stamping both minuets at once', () => {
    const hay = matchHay(['practised the Minuet in G Major for twenty minutes']);
    const blocked = ambiguousNeedles(shelf);
    const stamped = shelf.filter((i) => itemNamedIn(i.label, hay, blocked));
    expect(stamped).toEqual([]);
  });

  it('still stamps two pieces when the log genuinely names two', () => {
    const hay = matchHay(['worked on a short story and the happy farmer']);
    const blocked = ambiguousNeedles(shelf);
    const stamped = shelf.filter((i) => itemNamedIn(i.label, hay, blocked)).map((i) => i.label);
    expect(stamped).toEqual(['A Short Story (Lichner)', 'The Happy Farmer (from Album for the Young, Op. 68, No. 10)']);
  });

  it('handles two pieces whose titles differ ONLY by composer', () => {
    // The Anna Magdalena minuet is listed under both attributions in the Book 2 material.
    const both = [
      { label: 'Minuet in G Major (Petzold)', status: 'known', goal_id: PIANO },
      { label: 'Minuet in G Major (Anonymous)', status: 'known', goal_id: PIANO },
    ];
    expect(findItemForTitle(both, 'Minuet in G Major', PIANO)).toBeNull();
    expect(findItemForTitle(both, 'Minuet in G Major (Petzold)', PIANO)?.label).toBe('Minuet in G Major (Petzold)');
  });

  it('a shelf with no collisions blocks nothing', () => {
    const clean = [
      { label: 'Arietta', status: 'known', goal_id: PIANO },
      { label: 'Melody (Schumann)', status: 'known', goal_id: PIANO },
    ];
    expect(ambiguousNeedles(clean).size).toBe(0);
    expect(findItemForTitle(clean, 'Melody', PIANO)?.label).toBe('Melody (Schumann)');
  });
});

describe('isResolvable — no row that can never be found again', () => {
  it('refuses a bare title two pieces already answer to', () => {
    expect(isResolvable(shelf, 'Minuet in G Major')).toBe(false);
  });

  it('allows a qualified addition even though its core collides', () => {
    expect(isResolvable(shelf, 'Minuet in G Major (Petzold)')).toBe(true);
    expect(isResolvable(shelf, 'Minuet in G Major, BWV Anh. 114')).toBe(true);
  });

  it('allows a bare title while nothing else claims it — collision is what makes it bad', () => {
    expect(isResolvable([], 'Minuet in G Major')).toBe(true);
    expect(isResolvable([{ label: 'Arietta' }], 'Minuet in G Major')).toBe(true);
  });

  it('treats a re-mention of an existing piece as an update, not a collision with itself', () => {
    expect(isResolvable(shelf, 'Minuet in G Major, BWV 822')).toBe(true);
    expect(isResolvable(shelf, 'Écossaise (Hummel)')).toBe(true);
    expect(isResolvable(shelf, 'ecossaise (hummel)')).toBe(true);
  });

  it('allows an ordinary new piece', () => {
    expect(isResolvable(shelf, 'Für Elise, WoO 59')).toBe(true);
  });
});

describe('collidingTitles', () => {
  it('groups the pieces that share a title', () => {
    const groups = collidingTitles(shelf);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.shared).toBe('minuet in g major');
    expect(groups[0]!.labels).toEqual([
      'Minuet in G Major, BWV 822',
      'Minuet in G Major (from Notebook for Anna Magdalena Bach)',
    ]);
  });

  it('is empty for a shelf where every title is its own', () => {
    expect(collidingTitles([{ label: 'Arietta' }, { label: 'Melody (Schumann)' }])).toEqual([]);
  });
});

describe('renderRepertoireForCoach', () => {
  const items = shelf as unknown as RepertoireItem[];

  it('tells her which titles she must qualify, and names them', () => {
    const out = renderRepertoireForCoach(items);
    expect(out).toContain('TITLES THAT NAME MORE THAN ONE PIECE HERE');
    expect(out).toContain('"Minuet in G Major, BWV 822"');
    expect(out).toContain('"Minuet in G Major (from Notebook for Anna Magdalena Bach)"');
  });

  it('still renders the ordinary shelf above the warning', () => {
    const out = renderRepertoireForCoach(items);
    expect(out).toContain('Écossaise (Hummel)');
    expect(out.indexOf('Écossaise')).toBeLessThan(out.indexOf('TITLES THAT NAME'));
  });

  it('says nothing at all when no title collides — the usual case', () => {
    const clean = [{ label: 'Arietta', status: 'known' }] as unknown as RepertoireItem[];
    const out = renderRepertoireForCoach(clean);
    expect(out).toContain('Arietta');
    expect(out).not.toContain('TITLES THAT NAME');
  });

  it('renders nothing for an empty shelf rather than a bare warning', () => {
    expect(renderRepertoireForCoach([])).toBe('');
  });
});
