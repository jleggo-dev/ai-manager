/**
 * Describing a piece instead of naming it.
 *
 * "played the minuet from the Anna Magdalena notebook" names a piece on the shelf perfectly
 * clearly and used to match nothing, because every needle requires the stored label's words
 * CONTIGUOUSLY and the row reads "Minuet in G Major (from Notebook for Anna Magdalena Bach)".
 *
 * This route is looser by design, which is exactly how a false hit gets in — and a false hit
 * writes the wrong piece's history and never corrects itself. So the negatives below are the more
 * important half of this file: every one of them is a sentence someone could plausibly write in a
 * practice log, and none of them may claim a piece.
 *
 * Fixture is the real Suzuki Book 2 list, because the interesting cases only exist on a shelf that
 * genuinely collides.
 */
import { describe, expect, it } from 'vitest';
import { contentWords, describedItems, findItemForTitle } from './repertoire-practice.ts';

const PIANO = 'goal-piano';

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
const described = (text: string) => describedItems(shelf, [text]).map((i) => i.label);

describe('a description in someone’s own words finds the piece', () => {
  it('finds the Anna Magdalena minuet from a description, not its title', () => {
    expect(described('played the minuet from the Anna Magdalena notebook')).toEqual([
      'Minuet in G Major (from Notebook for Anna Magdalena Bach)',
    ]);
  });

  it('reads content words, not word order', () => {
    expect(described('worked on the Bartok hungarian folk song')).toEqual([
      'Hungarian Folk Song (from For Children, Sz. 42)',
    ]);
    expect(described('spent the session on children at play')).toEqual([
      'Children at Play (from For Children, Sz. 42)',
    ]);
  });

  it('does not require the catalogue tail nobody says out loud', () => {
    // "Op. 13, No. 2" is never spoken; requiring it made this exact sentence fail.
    expect(described('the cradle song by Weber')).toEqual(['Cradle Song, Op. 13, No. 2']);
    expect(described('did the happy farmer twice')).toEqual([
      'The Happy Farmer (from Album for the Young, Op. 68, No. 10)',
    ]);
    expect(described('the sonatina, moderato and romance')).toEqual([
      'Sonatina in G Major, Anh. 5 (Moderato, Romance)',
    ]);
  });
});

describe('what a description must NOT claim', () => {
  const nothing = [
    'my playing felt happy today', // one word of "The Happy Farmer"
    'I play piano every day', // "Children at Play" is distinguished only by "play"
    'worked from the notebook', // one word of the Anna Magdalena minuet
    'played a minuet', // three pieces answer to it
    'some Bach today',
    'practised scales and arpeggios',
    'young album work, op 68', // only words two items SHARE
    'children were playing outside', // "playing" is not "play"
    'g major scales', // shared key, no piece
    'played 1 piece and 10 scales', // bare catalogue numbers are not evidence
  ];

  for (const text of nothing) {
    it(`claims nothing from "${text}"`, () => {
      expect(described(text)).toEqual([]);
    });
  }
});

describe('the ambiguity rule still wins', () => {
  it('a shared title stays unresolvable even by description', () => {
    expect(findItemForTitle(shelf, 'Minuet in G Major', PIANO)).toBeNull();
    expect(described('played the minuet in g major')).toEqual([]);
  });

  it('an item no word distinguishes cannot be described — only named', () => {
    // "Minuet in G Major, BWV 822" shares every word with another item: minuet/g/major with the
    // Anna Magdalena one, bwv/822 with the G Minor one. Its full title still resolves.
    expect(described('minuet in g major bwv 822')).toEqual([]);
    expect(findItemForTitle(shelf, 'Minuet in G Major, BWV 822', PIANO)?.label).toBe('Minuet in G Major, BWV 822');
  });
});

describe('findItemForTitle falls through to description', () => {
  it('resolves a described step title when exactly one piece fits', () => {
    expect(findItemForTitle(shelf, 'the minuet from the anna magdalena notebook', PIANO)?.label).toBe(
      'Minuet in G Major (from Notebook for Anna Magdalena Bach)',
    );
  });

  it('still prefers an outright name over a description', () => {
    expect(findItemForTitle(shelf, 'Arietta', PIANO)?.label).toBe('Arietta');
    expect(findItemForTitle(shelf, 'Écossaise', PIANO)?.label).toBe('Écossaise (Hummel)');
  });

  it('returns null rather than choose between two described candidates', () => {
    const twins = [
      { label: 'Study in C (Czerny)', status: 'known', goal_id: PIANO },
      { label: 'Study in C (Burgmüller)', status: 'known', goal_id: PIANO },
    ];
    // Both are described equally well by their shared words; neither distinguishing word is said.
    expect(findItemForTitle(twins, 'a study in C', PIANO)).toBeNull();
  });
});

describe('contentWords', () => {
  it('drops articles, prepositions and catalogue scaffolding', () => {
    expect(contentWords('The Happy Farmer (from Album for the Young, Op. 68, No. 10)')).toEqual([
      'happy',
      'farmer',
      'album',
      'young',
      '68',
      '10',
    ]);
  });

  it('keeps the key, which distinguishes pieces', () => {
    expect(contentWords('Minuet in G Minor')).toEqual(['minuet', 'g', 'minor']);
  });

  it('folds accents like every other comparison here', () => {
    expect(contentWords('Écossaise')).toEqual(['ecossaise']);
  });

  it('is empty for a sentence of nothing but scaffolding', () => {
    expect(contentWords('the and of for')).toEqual([]);
  });
});
