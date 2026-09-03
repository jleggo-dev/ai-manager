import { describe, expect, it } from 'vitest';
import type { RepertoireItem, RepertoireStatus } from '@cadence/shared';
import {
  STANDING_ORDER,
  STANDING_WORDS,
  STANDING_EXPLANATION,
  buildCaption,
  formatDate,
  formatLastPracticed,
  formatTempoCaption,
} from './repertoireItemCopy.ts';

const NOW = new Date('2026-09-02T12:00:00Z');

function item(over: Partial<RepertoireItem> = {}): RepertoireItem {
  return {
    item_id: 'it-1',
    user_id: 'u1',
    goal_id: null,
    label: 'Clair de lune',
    status: 'known',
    kind: 'piece',
    meta: null,
    collection_id: null,
    collection_name: null,
    started_at: '2026-01-01T00:00:00Z',
    learned_at: null,
    last_practiced_at: null,
    ...over,
  };
}

describe('STANDING_ORDER / STANDING_WORDS / STANDING_EXPLANATION — every standing is covered', () => {
  const ALL: RepertoireStatus[] = ['queued', 'working', 'known', 'retired'];

  it('the control renders exactly the four standings, no more, no fewer', () => {
    expect(STANDING_ORDER).toEqual(ALL);
  });

  it.each(ALL)('%s has a user-facing word distinct from the schema word', (status) => {
    expect(STANDING_WORDS[status]).toBeTruthy();
    expect(STANDING_WORDS[status]).not.toBe(status);
  });

  it.each(ALL)('%s has a one-line explanation', (status) => {
    expect(STANDING_EXPLANATION[status].length).toBeGreaterThan(10);
  });

  it('never offers "learned" or "parked" as a word a person could mistake for a standing', () => {
    const words = Object.values(STANDING_WORDS);
    expect(words).not.toContain('learned');
    expect(words).not.toContain('parked');
  });
});

describe('formatDate', () => {
  it('drops the year for the current calendar year', () => {
    expect(formatDate('2026-03-14T10:00:00Z', NOW)).toBe('Mar 14');
  });

  it('keeps the year once it is a different calendar year', () => {
    expect(formatDate('2025-03-14T10:00:00Z', NOW)).toBe('Mar 14, 2025');
  });

  it('returns empty for an unparsable date rather than "Invalid Date"', () => {
    expect(formatDate('not-a-date', NOW)).toBe('');
  });
});

describe('formatLastPracticed — relative under 14 days, then a bare date', () => {
  it('never practiced', () => {
    expect(formatLastPracticed(null, NOW)).toBe('not yet');
    expect(formatLastPracticed(undefined, NOW)).toBe('not yet');
  });

  it('today and yesterday are named, not "0 days ago" / "1 days ago"', () => {
    expect(formatLastPracticed('2026-09-02T09:00:00Z', NOW)).toBe('today');
    expect(formatLastPracticed('2026-09-01T09:00:00Z', NOW)).toBe('yesterday');
  });

  it('2 to 13 days ago stays relative', () => {
    expect(formatLastPracticed('2026-08-31T12:00:00Z', NOW)).toBe('2 days ago');
    expect(formatLastPracticed('2026-08-20T12:00:00Z', NOW)).toBe('13 days ago');
  });

  it('the 14-day boundary crosses over to a bare date, not "14 days ago"', () => {
    expect(formatLastPracticed('2026-08-19T12:00:00Z', NOW)).toBe('Aug 19');
  });

  it('far enough back picks up the year too, via the same escalation as formatDate', () => {
    expect(formatLastPracticed('2025-01-05T12:00:00Z', NOW)).toBe('Jan 5, 2025');
  });

  it('an unparsable timestamp reads as never practiced rather than throwing', () => {
    expect(formatLastPracticed('not-a-date', NOW)).toBe('not yet');
  });
});

describe('formatTempoCaption', () => {
  it('names the bpm and the marking, and says it is read-only', () => {
    expect(formatTempoCaption({ bpm: 60, meter: 4 })).toBe(
      '♩ = 60 · Adagio · settled from your metronome · changes when you play, not here.',
    );
  });

  it('the marking comes from the shared tempoMarking table, not a second hand-copied one', () => {
    // 120 is Allegro's own floor in metronome.ts's MARKINGS table — this only stays true if this
    // file keeps deferring to that table instead of inventing its own boundaries.
    expect(formatTempoCaption({ bpm: 120, meter: 4 })).toContain('Allegro');
  });

  it('the meter clause appears only when it is not the common 4', () => {
    expect(formatTempoCaption({ bpm: 90, meter: 4 })).not.toContain('to the bar');
    expect(formatTempoCaption({ bpm: 96, meter: 3 })).toContain('3 to the bar');
  });
});

describe('buildCaption — every segment present only when there is a fact behind it', () => {
  it('a plain known item with nothing extra: just the standing word', () => {
    expect(buildCaption(item({ status: 'known' }))).toBe('Keeping up');
  });

  it('adds the learned month once learned_at is on file', () => {
    expect(buildCaption(item({ status: 'retired', learned_at: '2026-03-14T10:00:00Z' }))).toBe('Learned · learned Mar');
  });

  it('a backfilled learned item (no learned_at) never invents a month', () => {
    expect(buildCaption(item({ status: 'known', learned_at: null }))).toBe('Keeping up');
  });

  it('adds the compact tempo once a settled tempo is on file', () => {
    expect(buildCaption(item({ status: 'known', meta: { tempo_bpm: 72, tempo_meter: 4 } }))).toBe(
      'Keeping up · ♩ = 72',
    );
  });

  it('adds the session count only when the caller supplies one', () => {
    expect(buildCaption(item({ status: 'known' }), 23)).toBe('Keeping up · 23 sessions');
    expect(buildCaption(item({ status: 'known' }), 1)).toBe('Keeping up · 1 session');
    expect(buildCaption(item({ status: 'known' }))).toBe('Keeping up');
  });

  it('every segment together, in order', () => {
    const full = item({
      status: 'retired',
      learned_at: '2026-01-05T10:00:00Z',
      meta: { tempo_bpm: 60, tempo_meter: 4 },
    });
    expect(buildCaption(full, 8)).toBe('Learned · learned Jan · ♩ = 60 · 8 sessions');
  });

  /**
   * P8's word swap (books read "Finished", not "Learned") reaches this caption too, via
   * `standingWordFor` — a bug the item screen still had after P8 first shipped: the list row said
   * "Finished" for a book while this caption, reading `STANDING_WORDS` directly, still said
   * "Learned". Table: the domain that swaps, and the one that must not.
   */
  it('a finished book\'s caption says "Finished"', () => {
    expect(buildCaption(item({ status: 'retired', kind: 'book' }))).toBe('Finished');
  });

  it('a finished piece\'s caption still says "Learned" — the swap is books-only', () => {
    expect(buildCaption(item({ status: 'retired', kind: 'piece' }))).toBe('Learned');
  });
});
