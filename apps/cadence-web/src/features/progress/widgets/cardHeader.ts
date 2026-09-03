import type { GoalArea, RepertoirePayload, WidgetKind, WidgetPayload, WidgetSpec } from '@cadence/shared';
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
  felt_week: 'wind',
  shelf: 'star',
  stage_path: 'mountain',
  count_toward: 'book',
  balance: 'wind',
  total: 'gauge',
  variety: 'route',
  repertoire: 'note',
  then_now: 'gauge',
  photo_pair: 'camera',
  recap_rail: 'bubble',
  history: 'pen',
};

export function headerGlyphPath(kind: WidgetKind): string {
  return GLYPH[KIND_GLYPH[kind]];
}

/** Nouns for material held in memory rather than played or performed — "by heart" is the plain
 *  English idiom for that, and reads better than "learned" for a verse the way "learned" reads
 *  better for a piece. Keyed off the payload's own `noun` (never recomputed from `kind` here, and
 *  never hard-coded into the sentence itself) — 'learned' is the default for every other noun,
 *  including one we've never seen. */
const BY_HEART_NOUNS: ReadonlySet<string> = new Set(['verse', 'verses']);

/** "6 learned in 2026" / "5 by heart in 2026" (design frame 2c, owner 2026-09-02): the repertoire
 *  card's own measure is what was learned THIS YEAR, not the all-time counts — retiring a piece
 *  must read the same as keeping it up. `years` carries the current year already (the resolver's
 *  own `now`, never `new Date()` read here); an empty `years` (should not happen) drops the year
 *  rather than inventing one. */
function repertoireHeaderTag(data: RepertoirePayload): string {
  const verb = BY_HEART_NOUNS.has(data.noun) ? 'by heart' : 'learned';
  const year = data.years.at(-1)?.year;
  return year ? `${data.learned_in_year} ${verb} in ${year}` : `${data.learned_in_year} ${verb}`;
}

/** Kinds whose card is one goal's — the only place the deadline countdown belongs. */
const GOAL_SCOPED: ReadonlySet<WidgetKind> = new Set(['stage_path', 'count_toward']);

/**
 * "· Oct 4 · 34 days out" — appended to a goal-scoped card's tag when the layout carries the
 * goal's deadline (stamped server-side from the goal row). A deadline that has passed appends
 * nothing: the tab counts what happened, and an overdue tag would be a scoreboard.
 */
export function deadlineTag(spec: WidgetSpec, kind: WidgetKind, now = new Date()): string {
  if (!spec.deadline || !GOAL_SCOPED.has(kind)) return '';
  const end = new Date(`${spec.deadline}T12:00:00`);
  if (Number.isNaN(end.getTime())) return '';
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days = Math.round(
    (new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime() - today.getTime()) / 86400000,
  );
  if (days < 0) return '';
  const date = end.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return days === 0 ? ` · ${date} · today` : ` · ${date} · ${days} ${days === 1 ? 'day' : 'days'} out`;
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
    case 'felt_week':
      return 'felt · from your daily notes';
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
    case 'repertoire':
      return repertoireHeaderTag(payload.data);
    case 'then_now': {
      const since = new Date(`${payload.data.since}T12:00:00`);
      if (Number.isNaN(since.getTime())) return 'then → now';
      return `then → now · since ${since.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
    }
    case 'photo_pair':
      return 'photos · every 4 weeks · optional';
    case 'recap_rail':
      return 'weekly check-ins';
    case 'history':
      return ''; // rendered as a hairline section, not a glyph card — see WidgetSection
  }
}
