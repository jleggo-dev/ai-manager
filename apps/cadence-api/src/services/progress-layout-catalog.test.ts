/**
 * The catalog is a derivation, not a duplicate list — these tests hold that property, not just
 * today's content. If `WIDGET_KINDS` ever grows, TypeScript already refuses to compile until every
 * `Record<WidgetKind, ...>` in progress-layout-catalog.ts grows with it; this file is the runtime
 * half of the same guarantee.
 */
import { describe, it, expect } from 'vitest';
import { WIDGET_KINDS } from '@cadence/shared';
import { widgetCatalog, TEMPORAL_KINDS, NON_TEMPORAL_KINDS, PAGE_LEVEL_KINDS } from './progress-layout-catalog.ts';

describe('widgetCatalog', () => {
  it('has exactly one entry per WIDGET_KINDS member, in order, with nothing invented', () => {
    const catalog = widgetCatalog();
    expect(catalog.map((c) => c.kind)).toEqual([...WIDGET_KINDS]);
  });

  it('gives every entry a non-empty "shows" and "source_hint"', () => {
    for (const entry of widgetCatalog()) {
      expect(entry.shows.length).toBeGreaterThan(5);
      expect(entry.source_hint.length).toBeGreaterThan(3);
    }
  });

  it('files every kind into exactly one group', () => {
    for (const kind of WIDGET_KINDS) {
      const groups = [TEMPORAL_KINDS.has(kind), NON_TEMPORAL_KINDS.has(kind), PAGE_LEVEL_KINDS.has(kind)];
      expect(groups.filter(Boolean).length).toBe(1);
    }
  });

  it("matches docs/cadence/PROGRESS-ENGINE.md's own grouping", () => {
    expect([...TEMPORAL_KINDS].sort()).toEqual(
      ['dated_sessions', 'felt_week', 'rhythm', 'trend_vs_target', 'weekly_bars'].sort(),
    );
    expect([...NON_TEMPORAL_KINDS].sort()).toEqual(
      [
        'balance',
        'count_toward',
        'photo_pair',
        'repertoire',
        'shelf',
        'stage_path',
        'then_now',
        'total',
        'variety',
      ].sort(),
    );
    expect([...PAGE_LEVEL_KINDS].sort()).toEqual(['history', 'recap_rail'].sort());
  });
});
