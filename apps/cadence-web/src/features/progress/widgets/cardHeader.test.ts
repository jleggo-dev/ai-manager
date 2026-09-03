import { describe, expect, it } from 'vitest';
import type { WidgetSpec } from '@cadence/shared';
import { deadlineTag, headerTag } from './cardHeader.ts';
import { PRACTICE_FIXTURES } from './fixtures.ts';
import { VERSES_REPERTOIRE } from './repertoire-fixtures.ts';

const spec = (over: Partial<WidgetSpec>): WidgetSpec => ({ id: 'w', kind: 'stage_path', ...over });
const NOW = new Date('2026-08-31T10:00:00');

describe('deadlineTag', () => {
  it('counts down to a goal-scoped deadline, in the card tag', () => {
    expect(deadlineTag(spec({ deadline: '2026-10-04' }), 'stage_path', NOW)).toBe(' · Oct 4 · 34 days out');
    expect(deadlineTag(spec({ deadline: '2026-09-01' }), 'count_toward', NOW)).toBe(' · Sep 1 · 1 day out');
    expect(deadlineTag(spec({ deadline: '2026-08-31' }), 'stage_path', NOW)).toBe(' · Aug 31 · today');
  });

  it('says nothing for passed deadlines, other kinds, or specs without one', () => {
    // Counting what happened, never a scoreboard: an overdue tag would be shame in mono-caps.
    expect(deadlineTag(spec({ deadline: '2026-08-30' }), 'stage_path', NOW)).toBe('');
    expect(deadlineTag(spec({ deadline: '2026-10-04' }), 'trend_vs_target', NOW)).toBe('');
    expect(deadlineTag(spec({}), 'stage_path', NOW)).toBe('');
  });
});

describe('headerTag', () => {
  it('names the year and the count from the payload, never a stored sentence — "learned" by default', () => {
    expect(
      headerTag({
        kind: 'repertoire',
        data: {
          items: [],
          learned: 9,
          in_progress: 1,
          noun: 'pieces',
          learned_in_year: 6,
          learned_by_month: [],
          years: [
            { year: 2024, count: 1 },
            { year: 2025, count: 1 },
            { year: 2026, count: 6 },
          ],
          learning: 1,
          keeping_up: 8,
        },
      }),
    ).toBe('6 learned in 2026');
  });

  it('reads "by heart" for a verses noun — the idiom for held-in-memory text, keyed off the payload, never the kind recomputed client-side', () => {
    expect(
      headerTag({
        kind: 'repertoire',
        data: {
          items: [],
          learned: 7,
          in_progress: 1,
          noun: 'verses',
          learned_in_year: 5,
          learned_by_month: [],
          years: [
            { year: 2024, count: 0 },
            { year: 2025, count: 1 },
            { year: 2026, count: 5 },
          ],
          learning: 1,
          keeping_up: 6,
        },
      }),
    ).toBe('5 by heart in 2026');
  });

  it('drops the year rather than inventing one when years is somehow empty', () => {
    expect(
      headerTag({
        kind: 'repertoire',
        data: {
          items: [],
          learned: 0,
          in_progress: 0,
          noun: 'items',
          learned_in_year: 0,
          learned_by_month: [],
          years: [],
          learning: 0,
          keeping_up: 0,
        },
      }),
    ).toBe('0 learned');
  });

  it('produces the exact piano and verses measure lines from the shipped fixtures (design frame 2c)', () => {
    expect(headerTag(PRACTICE_FIXTURES.repertoire)).toBe('6 learned in 2026');
    expect(headerTag({ kind: 'repertoire', data: VERSES_REPERTOIRE })).toBe('5 by heart in 2026');
  });

  it('names the felt measure and its source', () => {
    expect(headerTag({ kind: 'felt_week', data: { weeks: [] } })).toBe('felt · from your daily notes');
  });

  it('dates the then_now card from the payload, and drops an unreadable date rather than inventing one', () => {
    expect(headerTag({ kind: 'then_now', data: { since: '2026-01-05', pairs: [] } })).toBe('then → now · since Jan 5');
    expect(headerTag({ kind: 'then_now', data: { since: 'not-a-date', pairs: [] } })).toBe('then → now');
  });
});
