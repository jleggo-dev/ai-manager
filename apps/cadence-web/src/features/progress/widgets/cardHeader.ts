import type { GoalArea, WidgetKind, WidgetPayload } from '@cadence/shared';
import { GLYPH, type GlyphName } from '../../today/glyphs.ts';
import { formatCaptionNumber } from './caption.ts';

/**
 * The card-header grammar (owner design "Cadence Progress", screen 1a): every goal card opens
 * with a 30px glyph chip in its family's pastel, the title, and a mono-caps line that NAMES THE
 * MEASURE TYPE — so "flat for two weeks" on a trend reads as information, not failure. This file
 * is the one documented place for all three maps: kind → glyph, kind → measure tag, area → chip
 * family. WidgetSection (registry.tsx) is the only consumer.
 */

/** Chip families = the goal areas as icon families, plus 'neutral' for a card whose spec/payload
 *  carries no honest area — a guess would misclassify, so no-area cards stay quiet. */
export type WidgetFamily = 'movement' | 'nutrition' | 'mind' | 'practice' | 'neutral';

/** The canonical goal area → the chip family it wears (same mapping category.ts uses). */
export function familyOfArea(area: GoalArea): WidgetFamily {
  if (area === 'nourishment') return 'nutrition';
  if (area === 'mind') return 'mind';
  if (area === 'practice') return 'practice';
  return 'movement';
}

/** Kind → glyph, deterministic — the chip identifies the measure's shape, not the goal's family
 *  (the family is the chip's COLOR, when honestly known). */
const KIND_GLYPH: Record<WidgetKind, GlyphName> = {
  rhythm: 'route',
  trend_vs_target: 'gauge',
  dated_sessions: 'route',
  weekly_bars: 'route',
  shelf: 'star',
  stage_path: 'mountain',
  count_toward: 'book',
  balance: 'wind',
  total: 'gauge',
  variety: 'route',
  recap_rail: 'bubble',
  history: 'pen',
};

export function headerGlyphPath(kind: WidgetKind): string {
  return GLYPH[KIND_GLYPH[kind]];
}

/** The mono-caps measure line under the title. Every fact here comes from the payload the
 *  resolver already computed — never a stored sentence that could go stale on re-window. */
export function headerTag(payload: WidgetPayload): string {
  switch (payload.kind) {
    case 'rhythm':
      return 'rhythm · week by week';
    case 'trend_vs_target':
      return `trend · target ${formatCaptionNumber(payload.data.target)} ${payload.data.unit}`;
    case 'dated_sessions':
      return `sessions · ${payload.data.total} logged`;
    case 'weekly_bars':
      return `weekly · ${payload.data.unit}`;
    case 'shelf':
      return 'bests & firsts';
    case 'stage_path': {
      const done = payload.data.stages.filter((s) => s.state === 'done').length;
      return `milestones · ${done} of ${payload.data.stages.length} cleared`;
    }
    case 'count_toward':
      return `count · toward ${formatCaptionNumber(payload.data.target)}`;
    case 'balance':
      return 'felt · session by session';
    case 'total':
      return `total · ${payload.data.window_label}`;
    case 'variety':
      return `variety · ${payload.data.window_label}`;
    case 'recap_rail':
      return 'weekly check-ins';
    case 'history':
      return ''; // rendered as a hairline section, not a glyph card — see WidgetSection
  }
}
