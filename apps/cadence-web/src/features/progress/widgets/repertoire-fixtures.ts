import type { RepertoirePayload } from '@cadence/shared';

/**
 * The two repertoire example payloads for "Progress counts what was learned this year" (design
 * frame 2c, owner 2026-09-02) — split out of fixtures.ts so that one card's illustrative data
 * doesn't grow the file past the size gate; PIANO_REPERTOIRE plugs into PRACTICE_FIXTURES.repertoire
 * there, and VERSES_REPERTOIRE is re-exported from there for callers that already import from
 * fixtures.ts. Both exercise the same rulings: a retired piece counts toward its year exactly like
 * a known one, a backfilled item (no `learned_at`) never counts into any year, `learned_by_month`
 * stays in month order, and no week count reads 0.
 */

/** The piano shelf: 6 pieces crossed to learned within 2026 ("6 learned in 2026"), one of them
 *  retired ("Moonlight Sonata" — finishing never shrinks the count), and "Für Elise" is backfilled
 *  (known before Cadence, no learned_at, never counted into a year). */
export const PIANO_REPERTOIRE: RepertoirePayload = {
  items: [
    { label: 'Nocturne in E-flat', state: 'learned', learned_month: '2026-02' },
    { label: 'Gymnopédie №1', state: 'learned', learned_month: '2026-03' },
    { label: 'Écossaise', state: 'learned', learned_month: '2026-05' },
    { label: "Comptine d'un autre été", state: 'learned', learned_month: '2026-06' },
    { label: 'Moonlight Sonata', state: 'learned', learned_month: '2026-06' }, // retired
    { label: 'Prelude in C', state: 'learned', learned_month: '2026-08' },
    { label: 'Für Elise', state: 'learned', learned_month: null }, // backfilled
    { label: 'Clair de lune', state: 'in_progress', weeks_in: 6 },
    { label: 'River Flows in You', state: 'not_started' },
  ],
  learned: 7,
  in_progress: 1,
  noun: 'pieces',
  learned_in_year: 6,
  learned_by_month: [
    { month: '2026-02', label: 'Nocturne in E-flat', weeks: 8 },
    { month: '2026-03', label: 'Gymnopédie №1', weeks: 6 },
    { month: '2026-05', label: 'Écossaise', weeks: 5 },
    { month: '2026-06', label: "Comptine d'un autre été", weeks: 4 },
    { month: '2026-06', label: 'Moonlight Sonata', weeks: 10 },
    { month: '2026-08', label: 'Prelude in C', weeks: 3 },
  ],
  years: [
    { year: 2024, count: 0 },
    { year: 2025, count: 0 },
    { year: 2026, count: 6 },
  ],
  learning: 1,
  keeping_up: 6,
};

/** A verses shelf — same repertoire grammar, a different domain: memorized text reads "by heart"
 *  instead of "learned" (design frame 2c), keyed off this payload's own `noun` in cardHeader.ts,
 *  never hard-coded per domain. 5 crossed to learned within 2026 ("5 by heart in 2026"), one
 *  retired ("1 Corinthians 13"), and "The Lord's Prayer" is backfilled — never counted into a
 *  year. */
export const VERSES_REPERTOIRE: RepertoirePayload = {
  items: [
    { label: 'Psalm 100', state: 'learned', learned_month: '2026-01' },
    { label: 'John 3:16', state: 'learned', learned_month: '2026-03' },
    { label: 'Philippians 4:13', state: 'learned', learned_month: '2026-04' },
    { label: 'Romans 8:28', state: 'learned', learned_month: '2026-04' },
    { label: '1 Corinthians 13', state: 'learned', learned_month: '2026-07' }, // retired
    { label: "The Lord's Prayer", state: 'learned', learned_month: null }, // backfilled
    { label: 'Isaiah 40:31', state: 'in_progress', weeks_in: 4 }, // first stanza, week 4 — not a miss
    { label: 'Psalm 139', state: 'not_started' },
  ],
  learned: 6,
  in_progress: 1,
  noun: 'verses',
  learned_in_year: 5,
  learned_by_month: [
    { month: '2026-01', label: 'Psalm 100', weeks: 6 },
    { month: '2026-03', label: 'John 3:16', weeks: 2 },
    { month: '2026-04', label: 'Philippians 4:13', weeks: 3 },
    { month: '2026-04', label: 'Romans 8:28', weeks: 5 },
    { month: '2026-07', label: '1 Corinthians 13', weeks: 9 },
  ],
  years: [
    { year: 2024, count: 0 },
    { year: 2025, count: 0 },
    { year: 2026, count: 5 },
  ],
  learning: 1,
  keeping_up: 5,
};
